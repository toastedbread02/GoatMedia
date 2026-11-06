/**
 * Development seed data for GoatMedia.
 *
 *   npm run seed:dev
 *
 * Creates four development accounts and a set of clearly credited sample clips
 * from Wikimedia Commons, converted to the same MP4 the upload pipeline makes.
 * Seeded videos have no invented views, likes or comments: sample footage is
 * not fake community activity.
 *
 * The clips are downloaded only when they are missing. The script is safe to
 * run repeatedly; existing seeded rows are left alone.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { hashPassword } from '../server/auth.ts';
import { MEDIA_DIR, POSTER_DIR, TEMP_DIR, ensureDataDirs } from '../server/config.ts';
import { get, run } from '../server/db.ts';
import { makePoster, prepareVideo, probeVideo } from '../server/media.ts';

const DAY = 86_400_000;
const DEV_PASSWORD = 'goats-like-clover';

interface Sample {
  url: string;
  title: string;
  artist: string;
  license: string;
}

const samples: Record<string, Sample> = {
  'two-baby-goats': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/2/27/Two_Baby_Goats_in_Himalaya.webm',
    title: 'Two Baby Goats in Himalaya',
    artist: 'Diikshachauhan3147',
    license: 'CC BY-SA 4.0',
  },
  'pygmy-kid': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/2/2b/Pygmy_goat_baby.webm/Pygmy_goat_baby.webm.480p.vp9.webm',
    title: 'Pygmy goat baby',
    artist: 'shelleylyn',
    license: 'CC BY-SA 2.0',
  },
  'irish-kids': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/5/5e/Baby_goats_in_Ireland.webm/Baby_goats_in_Ireland.webm.480p.vp9.webm',
    title: 'Baby goats in Ireland',
    artist: 'Loz Pycock',
    license: 'CC BY-SA 2.0',
  },
  grooming: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/2/20/Anglo-Nubian_goats_grooming_themselves.webm',
    title: 'Anglo-Nubian goats grooming themselves',
    artist: 'Rivadavia.vila',
    license: 'CC0',
  },
  'herd-politics': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/3/39/The_goats_behavior_within_a_herd.webm',
    title: 'The goats behavior within a herd',
    artist: 'Tamtam90',
    license: 'CC BY-SA 4.0',
  },
  ibex: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/5/5d/Bezoar_ibex_video.webm/Bezoar_ibex_video.webm.480p.vp9.webm',
    title: 'Bezoar ibex video',
    artist: 'Gail Hampshire',
    license: 'CC BY 2.0',
  },
  'snow-goat': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/7/78/YohoNationalpark-Oreamnos_americanus-Schneeziege.ogv',
    title: 'Yoho National Park mountain goat',
    artist: 'Hedwig Storch',
    license: 'CC BY-SA 3.0',
  },
  chewing: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/2/2d/Goat_eating.webm',
    title: 'Goat eating',
    artist: 'Okkisafire',
    license: 'CC BY-SA 3.0',
  },
  'sunnyvale-herd': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/b/b0/Goats_mowing_Sunnyvale_landfill.webm/Goats_mowing_Sunnyvale_landfill.webm.480p.vp9.webm',
    title: 'Goats mowing Sunnyvale landfill',
    artist: 'Kat Walsh',
    license: 'CC BY 4.0',
  },
  'garden-climb': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/6/67/Goat_Capel_Manor_College_Gardens_Enfield_London_England_05.webm/Goat_Capel_Manor_College_Gardens_Enfield_London_England_05.webm.480p.vp9.webm',
    title: 'Goat at Capel Manor College Gardens',
    artist: 'Acabashi',
    license: 'CC BY-SA 4.0',
  },
  'mirke-hillside': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/8/85/2022-10-01_MIRKE_ARTIODACTYLA_Capra_aegagrus_hircus_DOMA%C4%8CA_KOZA.webm/2022-10-01_MIRKE_ARTIODACTYLA_Capra_aegagrus_hircus_DOMA%C4%8CA_KOZA.webm.480p.vp9.webm',
    title: 'Goats on a hillside in Mirke',
    artist: 'NaIzletuSi',
    license: 'CC BY 3.0',
  },
};

const creators = [
  {
    username: 'barnnotes',
    displayName: 'Barn Notes',
    bio: 'Notes from a smallholding. Mostly goats, occasionally a fence that needs fixing.',
  },
  {
    username: 'highcountry',
    displayName: 'High Country Goats',
    bio: 'Wild goats, thin air and questionable footing.',
  },
  {
    username: 'kidsofcapra',
    displayName: 'Kids of Capra',
    bio: 'Baby goats and the people who film them.',
  },
  {
    username: 'sunnyvaleherd',
    displayName: 'Sunnyvale Herd',
    bio: 'A working herd with a very specific job.',
  },
];

interface SeedVideo {
  slug: string;
  creator: string;
  caption: string;
  category: string;
  hashtags: string[];
  sample: keyof typeof samples;
  daysAgo: number;
  status: 'approved' | 'pending';
}

const videos: SeedVideo[] = [
  {
    slug: 'himalaya-path',
    creator: 'kidsofcapra',
    caption: 'Two kids on a Himalayan path, taking the steep way',
    category: 'baby-goats',
    hashtags: ['goatkids', 'himalaya', 'climbing'],
    sample: 'two-baby-goats',
    daysAgo: 2,
    status: 'approved',
  },
  {
    slug: 'pygmy-lens',
    creator: 'kidsofcapra',
    caption: 'A pygmy kid investigates the camera lens',
    category: 'baby-goats',
    hashtags: ['goatkids', 'pygmy'],
    sample: 'pygmy-kid',
    daysAgo: 4,
    status: 'approved',
  },
  {
    slug: 'irish-spring',
    creator: 'barnnotes',
    caption: 'Irish spring: a small crowd of kids and one patient mother',
    category: 'baby-goats',
    hashtags: ['goatkids', 'spring'],
    sample: 'irish-kids',
    daysAgo: 6,
    status: 'approved',
  },
  {
    slug: 'grooming-hour',
    creator: 'barnnotes',
    caption: 'Grooming hour at the fence',
    category: 'farm-life',
    hashtags: ['grooming', 'nubian'],
    sample: 'grooming',
    daysAgo: 1,
    status: 'approved',
  },
  {
    slug: 'hay-bale-politics',
    creator: 'barnnotes',
    caption: 'Herd politics, settled over a hay bale',
    category: 'farm-life',
    hashtags: ['herd', 'hay'],
    sample: 'herd-politics',
    daysAgo: 5,
    status: 'approved',
  },
  {
    slug: 'ibex-cliff',
    creator: 'highcountry',
    caption: 'An ibex on a cliff that should not be walkable',
    category: 'mountain-goats',
    hashtags: ['ibex', 'cliffs'],
    sample: 'ibex',
    daysAgo: 3,
    status: 'approved',
  },
  {
    slug: 'snowfield',
    creator: 'highcountry',
    caption: 'A mountain goat crossing a snowfield like it owns the place',
    category: 'mountain-goats',
    hashtags: ['mountaingoat', 'snow'],
    sample: 'snow-goat',
    daysAgo: 7,
    status: 'approved',
  },
  {
    slug: 'chewing-soundtrack',
    creator: 'barnnotes',
    caption: 'The chew is the whole soundtrack',
    category: 'goat-sounds',
    hashtags: ['asmr', 'chewing'],
    sample: 'chewing',
    daysAgo: 8,
    status: 'approved',
  },
  {
    slug: 'landfill-crew',
    creator: 'sunnyvaleherd',
    caption: 'The Sunnyvale herd at work on the landfill slopes',
    category: 'farm-life',
    hashtags: ['workinggoats', 'conservation'],
    sample: 'sunnyvale-herd',
    daysAgo: 4,
    status: 'approved',
  },
  {
    slug: 'garden-climb',
    creator: 'highcountry',
    caption: 'Nothing to climb here, so the wall will do',
    category: 'parkour',
    hashtags: ['climbing', 'parkour'],
    sample: 'garden-climb',
    daysAgo: 2,
    status: 'approved',
  },
  {
    slug: 'mirke-hillside',
    creator: 'highcountry',
    caption: 'A hillside herd in Mirke, unbothered by the view',
    category: 'mountain-goats',
    hashtags: ['herd', 'hillside'],
    sample: 'mirke-hillside',
    daysAgo: 6,
    status: 'approved',
  },
  {
    slug: 'new-kids-pending',
    creator: 'barnnotes',
    caption: 'First look at this spring’s new kids',
    category: 'baby-goats',
    hashtags: ['goatkids', 'spring'],
    sample: 'irish-kids',
    daysAgo: 0,
    status: 'pending',
  },
];

async function download(url: string, destination: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'GoatMediaDevSeed/1.0 (+https://github.com/toastedbread02/GoatMedia)' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(destination, buffer);
  console.log(`  downloaded ${(buffer.length / (1024 * 1024)).toFixed(1)} MB`);
}

async function ensureMedia(video: SeedVideo) {
  ensureDataDirs();
  const id = `seed-${video.slug}`;
  const sample = samples[video.sample];
  const videoPath = path.join(MEDIA_DIR, `${id}.mp4`);
  const posterPath = path.join(POSTER_DIR, `${id}.jpg`);

  if (!fs.existsSync(videoPath)) {
    console.log(`Preparing ${video.slug} from Wikimedia Commons…`);
    const sourcePath = path.join(TEMP_DIR, `${id}.source`);
    await download(sample.url, sourcePath);
    try {
      const prepared = await prepareVideo(sourcePath, videoPath, null);
      if (!prepared) throw new Error('ffmpeg could not read the downloaded sample.');
    } finally {
      await fs.promises.rm(sourcePath, { force: true });
    }
  }

  const probe = await probeVideo(videoPath);
  if (!probe || !probe.duration) throw new Error(`Could not probe ${videoPath}. Is ffmpeg installed?`);
  if (!fs.existsSync(posterPath)) await makePoster(videoPath, posterPath, probe.duration);

  return {
    videoPath,
    posterPath: fs.existsSync(posterPath) ? posterPath : null,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    size: (await fs.promises.stat(videoPath)).size,
    credit: `${sample.title} — ${sample.artist}, ${sample.license}`,
  };
}

async function ensureCreator(creator: (typeof creators)[number]) {
  const existing = get<{ id: string }>(`SELECT id FROM users WHERE lower(username) = ?`, creator.username);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  run(
    `INSERT INTO users (id, email, username, display_name, bio, password_hash, role, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'user', 'active', ?)`,
    id,
    `${creator.username}@goatmedia.test`,
    creator.username,
    creator.displayName,
    creator.bio,
    await hashPassword(DEV_PASSWORD),
    Date.now() - 30 * DAY,
  );
  console.log(`  created @${creator.username}`);
  return id;
}

async function main() {
  console.log('\nSeeding GoatMedia development data. Nothing here is published without review except approved samples.\n');
  const ids = new Map<string, string>();
  for (const creator of creators) ids.set(creator.username, await ensureCreator(creator));

  for (const video of videos) {
    const id = `seed-${video.slug}`;
    if (get(`SELECT id FROM videos WHERE id = ?`, id)) {
      console.log(`  ${video.slug} already exists`);
      continue;
    }
    const media = await ensureMedia(video);
    const creatorId = ids.get(video.creator)!;
    const publishedAt = video.status === 'approved' ? Date.now() - video.daysAgo * DAY - 3 * 60 * 60 * 1000 : null;
    const createdAt = video.status === 'approved' ? (publishedAt ?? Date.now()) - DAY : Date.now() - 2 * 60 * 60 * 1000;

    run(
      `INSERT INTO videos (id, owner_id, caption, category, hashtags, file_name, mime, poster_name, duration, width, height,
         size_bytes, status, created_at, updated_at, published_at, credit, seed)
       VALUES (?, ?, ?, ?, ?, ?, 'video/mp4', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      id,
      creatorId,
      video.caption,
      video.category,
      JSON.stringify(video.hashtags),
      path.basename(media.videoPath),
      media.posterPath ? path.basename(media.posterPath) : null,
      media.duration,
      media.width,
      media.height,
      media.size,
      video.status,
      createdAt,
      createdAt,
      publishedAt,
      media.credit,
    );
    run(
      `INSERT INTO moderation_events (id, video_id, admin_id, action, reason, created_at)
       VALUES (?, ?, NULL, 'submit', NULL, ?)`,
      crypto.randomUUID(),
      id,
      createdAt,
    );
    if (video.status === 'approved') {
      run(
        `INSERT INTO moderation_events (id, video_id, admin_id, action, reason, created_at)
         VALUES (?, ?, NULL, 'approve', ?, ?)`,
        crypto.randomUUID(),
        id,
        'Seeded development sample, reviewed by the developer',
        publishedAt ?? Date.now(),
      );
    }
    console.log(`  ${video.status === 'approved' ? 'published' : 'queued for review'}: ${video.caption}`);
  }

  console.log(`
Done. Development accounts (password: ${DEV_PASSWORD}):

${creators.map((creator) => `  @${creator.username} — ${creator.displayName}`).join('\n')}

Sample clips are from Wikimedia Commons, credited on each video and never
counted as real views or community activity.

Next: create the moderator account, then sign in and open /admin.

  npm run admin:create -- --email you@example.com --username keeper
`);
}

await main().catch((error) => {
  console.error('\nSeed failed:', error instanceof Error ? error.message : error);
  if (error instanceof Error && /ffmpeg/.test(error.message)) {
    console.error('Install ffmpeg, or run the app and upload a video manually.');
  }
  process.exit(1);
});
