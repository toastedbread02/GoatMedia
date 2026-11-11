// Build-time SEO pass.
//
// GitHub Pages has no rewrite rule, so /GoatMedia/v/pst_123 answers 404 with the
// app shell. Google drops those URLs, and the shell's canonical tag points every
// page at the homepage, which marks the whole site as a duplicate of one URL.
//
// This runs after `vite build` and gives every indexable route a real directory
// (`v/<id>/index.html`), which Pages serves with a 200 and the correct title,
// description, canonical and structured data. Then it writes a sitemap.
//
// The pages are still the same React shell: the router boots and renders the
// live post. Only the head and the sitemap are static, because those are what a
// crawler reads before it runs any JavaScript.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DIST = 'dist';
const BASE = (process.env.VITE_BASE_PATH || '/').replace(/\/?$/, '/');
const API = (process.env.VITE_API_ORIGIN || 'https://goatmedia-api.dominikkoba22.workers.dev').replace(
  /\/+$/,
  '',
);
const repo = process.env.GITHUB_REPOSITORY || '';
const owner = repo ? repo.split('/')[0] : 'toastedbread02';
const SITE = (process.env.SITE_ORIGIN || `https://${owner}.github.io`).replace(/\/+$/, '');
/** Absolute site root, always with a trailing slash: https://host/GoatMedia/ */
const ROOT = `${SITE}${BASE}`;

const esc = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Google shows roughly 155 characters; longer descriptions get cut mid-word. */
function clip(text, max = 155) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

async function collectPosts() {
  const seen = new Map();
  // For You is personalised and caps out before every post; the trending tab
  // is the cheapest way to pick up the ones it left out.
  for (const tab of ['foryou', 'trending']) {
    for (let page = 1; page <= 20; page += 1) {
      const data = await fetchJson(`${API}/api/feed?tab=${tab}&page=${page}`);
      const items = Array.isArray(data.items) ? data.items : [];
      for (const item of items) {
        if (item?.id && !seen.has(item.id)) seen.set(item.id, item);
      }
      if (!data.hasMore || items.length === 0) break;
    }
  }
  return [...seen.values()];
}

async function collectSounds() {
  try {
    const data = await fetchJson(`${API}/api/sounds?page=1&limit=100`);
    return Array.isArray(data.sounds) ? data.sounds : [];
  } catch {
    return [];
  }
}

const isoDate = (value) => {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date().toISOString();
};

function postRoute(post) {
  const creator = post.creator || {};
  const username = creator.username || 'goatmedia';
  const caption = (post.caption || '').trim();
  const category = post.categoryLabel || '';
  const title = caption ? `${caption} — @${username}` : `A ${category || 'goat'} post by @${username}`;
  const description = caption
    ? clip(`${caption} — ${category ? `${category} on ` : ''}GoatMedia, a video community for goats.`)
    : clip(`Watch a ${category || 'goat'} post from @${username} on GoatMedia.`);
  const url = `${ROOT}v/${post.id}/`;
  const image = post.posterUrl || null;
  const imageAlt = caption ? `${caption} — a post by @${username}` : `A post by @${username}`;
  const isVideo = post.kind === 'video';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': isVideo ? 'VideoObject' : 'ImageGallery',
    name: caption || `Post by @${username}`,
    description,
    url,
    uploadDate: isoDate(post.publishedAt || post.createdAt),
    author: {
      '@type': 'Person',
      name: creator.displayName || username,
      url: `${ROOT}u/${username}/`,
    },
    ...(image ? { thumbnailUrl: image } : {}),
    ...(isVideo && post.videoUrl ? { contentUrl: post.videoUrl } : {}),
  };

  return { path: `v/${post.id}/`, title, description, url, image, imageAlt, kind: isVideo ? 'video' : 'article', jsonLd, lastmod: jsonLd.uploadDate };
}

function creatorRoute(username, posts) {
  const count = posts.length;
  const title = `@${username} on GoatMedia`;
  const description = clip(
    `${count} goat ${count === 1 ? 'post' : 'posts'} from @${username}, each watched by a person before it goes live.`,
  );
  const url = `${ROOT}u/${username}/`;
  const image = posts.find((post) => post.posterUrl)?.posterUrl || null;
  const lastmod = posts
    .map((post) => isoDate(post.publishedAt || post.createdAt))
    .sort()
    .at(-1);

  return {
    path: `u/${username}/`,
    title,
    description,
    url,
    image,
    imageAlt: `@${username} on GoatMedia`,
    kind: 'profile',
    lastmod,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      url,
      name: title,
      description,
      mainEntity: { '@type': 'Person', name: username, url },
    },
  };
}

function soundRoute(sound, posts) {
  const title = `${sound.title || 'A sound'} — goat videos on GoatMedia`;
  const description = clip(
    `Every goat post that uses the sound “${sound.title || 'this sound'}” on GoatMedia.`,
  );
  const url = `${ROOT}sound/${sound.id}/`;
  const image = posts.find((post) => post.posterUrl)?.posterUrl || null;

  return {
    path: `sound/${sound.id}/`,
    title,
    description,
    url,
    image,
    imageAlt: `${sound.title || 'A sound'} on GoatMedia`,
    kind: 'music.playlist',
    lastmod: posts
      .map((post) => isoDate(post.publishedAt || post.createdAt))
      .sort()
      .at(-1),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      url,
      name: title,
      description,
    },
  };
}

function homeRoute(posts) {
  const title = 'GoatMedia — a video community for goats';
  const description =
    'Goat videos and photos, uploaded by people and watched by a human before they go live. No autoplay farm, no algorithm guessing.';
  const url = ROOT;
  return {
    path: '',
    title,
    description,
    url,
    image: posts.find((post) => post.posterUrl)?.posterUrl || null,
    imageAlt: 'GoatMedia — goat videos, watched by a person before they go live',
    kind: 'website',
    lastmod: posts
      .map((post) => isoDate(post.publishedAt || post.createdAt))
      .sort()
      .at(-1),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      url,
      name: 'GoatMedia',
      description,
    },
  };
}

/** Rewrites one shell into a page that describes itself correctly. */
function rewrite(html, route) {
  let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(route.title)}</title>`);

  const meta = (attr, key, value) => {
    if (!value) return;
    const tag = `<meta ${attr}="${key}" content="${esc(value)}">`;
    const pattern = new RegExp(`<meta ${attr}="${key}"[^>]*>`);
    out = pattern.test(out) ? out.replace(pattern, tag) : out.replace('</head>', `  ${tag}\n  </head>`);
  };

  meta('name', 'description', route.description);
  meta('property', 'og:title', route.title);
  meta('property', 'og:description', route.description);
  meta('property', 'og:url', route.url);
  meta('property', 'og:type', route.kind === 'website' ? 'website' : 'article');
  meta('name', 'twitter:title', route.title);
  meta('name', 'twitter:description', route.description);
  if (route.image) {
    meta('property', 'og:image', route.image);
    meta('name', 'twitter:image', route.image);
    if (route.imageAlt) meta('property', 'og:image:alt', route.imageAlt);
    // The 1200x630 pair describes the social card, not a post poster; leaving
    // it on a poster makes every share crop to the wrong shape.
    out = out.replace(/\s*<meta property="og:image:(width|height)"[^>]*>/g, '');
  }

  const canonical = `<link rel="canonical" href="${esc(route.url)}">`;
  const canonicalPattern = /<link rel="canonical"[^>]*>/;
  out = canonicalPattern.test(out)
    ? out.replace(canonicalPattern, canonical)
    : out.replace('</head>', `  ${canonical}\n  </head>`);

  const structured = `<script type="application/ld+json">${JSON.stringify(route.jsonLd)}</script>`;
  return out.replace('</head>', `  ${structured}\n  </head>`);
}

function sitemap(routes) {
  const urls = routes
    .map((route) => {
      const lastmod = route.lastmod ? `<lastmod>${route.lastmod.slice(0, 10)}</lastmod>` : '';
      return `  <url><loc>${esc(route.url)}</loc>${lastmod}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function main() {
  const shell = await readFile(join(DIST, 'index.html'), 'utf8');
  let posts = [];
  let sounds = [];

  try {
    posts = await collectPosts();
    sounds = await collectSounds();
  } catch (error) {
    // A build that cannot reach the API still has to ship: the app works, it
    // just keeps the generic homepage metadata until the next deploy.
    console.warn(`::warning::SEO prerender skipped: ${error.message}`);
  }

  const byCreator = new Map();
  for (const post of posts) {
    const username = post.creator?.username;
    if (!username) continue;
    byCreator.set(username, [...(byCreator.get(username) || []), post]);
  }

  const routes = [
    homeRoute(posts),
    ...posts.map(postRoute),
    ...[...byCreator.entries()].map(([username, list]) => creatorRoute(username, list)),
    ...sounds
      .map((sound) => soundRoute(sound, posts.filter((post) => post.sound?.id === sound.id)))
      .filter((route, index, all) => all.findIndex((item) => item.path === route.path) === index),
  ];

  for (const route of routes) {
    const file = join(DIST, route.path, 'index.html');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, rewrite(shell, route));
  }

  await writeFile(join(DIST, 'sitemap.xml'), sitemap(routes));

  // The worker names its cache after this build, so the previous one is kept
  // until the new worker activates and then deleted.
  try {
    const workerPath = join(DIST, 'sw.js');
    const worker = await readFile(workerPath, 'utf8');
    const build = createHash('sha256').update(shell).update(worker).digest('hex').slice(0, 12);
    await writeFile(workerPath, worker.replace('__BUILD__', build));
  } catch {
    // A build without a worker is still a build.
  }

  // Pages answers any path it has no file for with 404.html. Serving the shell
  // there is what lets a path that was typed rather than clicked boot the app
  // and route itself, instead of ending on the Pages error page. It is kept out
  // of search on purpose: these pages are meant to be found, not indexed.
  const fallback = shell.replace('</head>', '  <meta name="robots" content="noindex">\n  </head>');
  await writeFile(join(DIST, '404.html'), fallback);

  console.log(
    `SEO: prerendered ${routes.length} routes, ${posts.length} posts, sitemap at ${ROOT}sitemap.xml`,
  );
}

await main();
