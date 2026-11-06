import {
  Env,
  bad,
  denied,
  json,
  missing,
  now,
  optionalStr,
  pageOf,
  rateLimit,
  readJson,
  uid,
} from '../lib';
import { requireActive, currentUser } from '../session';
import { categoryById, limits, postReportReasons } from '../config';
import { hydratePosts, PostRow, POST_SELECT } from '../models';
import { followingFeed, forYouFeed, trendingFeed, invalidateTrending } from '../recommend';
import { applySignal, recordEvent, undoEvent } from '../interests';

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav']);

const MAX_PHOTO_BYTES = limits.maxPhotoMb * 1024 * 1024;
const MAX_AUDIO_BYTES = limits.maxAudioMb * 1024 * 1024;

export function parseHashtags(caption: string): string[] {
  const found = caption.match(/#([a-z0-9_]{2,24})/gi) || [];
  return [...new Set(found.map((tag) => tag.slice(1).toLowerCase()))].slice(0, 8);
}

function looksLikeImage(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === 'image/png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mime === 'image/webp') {
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    );
  }
  return false;
}

function looksLikeAudio(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (mime === 'audio/mpeg') {
    return (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  if (mime === 'audio/mp4') return ascii(4, 8) === 'ftyp';
  if (mime === 'audio/ogg') return ascii(0, 4) === 'OggS';
  if (mime === 'audio/wav') return ascii(0, 4) === 'RIFF';
  if (mime === 'audio/aac') return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  return false;
}

export async function feed(req: Request, env: Env, origin: string, url: URL) {
  const tab = url.searchParams.get('tab') || 'foryou';
  const { page } = pageOf(url.searchParams.get('page'), limits.feedPageSize);
  const viewer = await currentUser(req, env);

  if (tab === 'following' && !viewer) {
    return json({ items: [], hasMore: false, page, requiresSignIn: true });
  }
  if (viewer && viewer.status === 'suspended') {
    return json({ items: [], hasMore: false, page, suspended: true });
  }

  const result =
    tab === 'trending'
      ? await trendingFeed(env, viewer?.id ?? null, page)
      : tab === 'following'
        ? await followingFeed(env, viewer!.id, page)
        : await forYouFeed(env, viewer?.id ?? null, page);

  const items = await hydratePosts(env, origin, viewer?.id ?? null, result.rows);
  for (const item of items) item.reason = result.reasons.get(item.id) || null;
  return json({ items, hasMore: result.hasMore, page });
}

export async function postDetail(req: Request, env: Env, origin: string, id: string) {
  const viewer = await currentUser(req, env);
  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`)
    .bind(id)
    .first<PostRow>();
  if (!row) throw missing('That post is not here.');
  if (row.status !== 'approved') {
    const privileged = viewer && (viewer.id === row.owner_id || viewer.role === 'admin');
    if (!privileged) throw missing('That post is not here.');
  }
  const [post] = await hydratePosts(env, origin, viewer?.id ?? null, [row]);
  return json({ post });
}

async function publicSoundUsable(env: Env, soundId: string, userId: string) {
  const row = await env.DB.prepare(
    `SELECT s.id, s.owner_id,
            EXISTS(SELECT 1 FROM posts p WHERE p.sound_id = s.id AND p.status = 'approved') AS live
       FROM sounds s WHERE s.id = ?`,
  )
    .bind(soundId)
    .first<{ id: string; owner_id: string; live: number }>();
  if (!row) throw bad('That sound is no longer available.');
  if (!row.live && row.owner_id !== userId) {
    throw bad('That sound is still waiting for review.');
  }
  return row;
}

export async function createPost(req: Request, env: Env, origin: string) {
  const user = await requireActive(req, env);
  await rateLimit(
    env,
    `post:${user.id}`,
    8,
    60 * 60 * 1000,
    'That is a lot of posts in one hour. Take a breather and try again later.',
  );

  const form = await req.formData().catch(() => null);
  if (!form) throw bad('The upload could not be read. Try again.');

  const caption = optionalStr(form.get('caption'), limits.maxCaptionLength) || '';
  const category = String(form.get('category') || '');
  if (!categoryById.has(category)) throw bad('Pick a category for your post.');

  const files = form.getAll('photos').filter((entry): entry is File => entry instanceof File);
  if (!files.length) throw bad('Add at least one photo.');
  if (files.length > limits.maxPhotos) {
    throw bad(`You can add up to ${limits.maxPhotos} photos to one post.`);
  }
  if (files.length > 1 && files.some((f) => f.size === 0)) throw bad('One of those photos was empty.');

  const photos: { id: string; bytes: ArrayBuffer; mime: string; size: number; position: number }[] = [];
  for (const [index, file] of files.entries()) {
    const type = file.type || 'image/jpeg';
    if (!PHOTO_TYPES.has(type)) {
      throw bad('Photos need to be JPEG, PNG or WebP. iPhone HEIC files should be converted first.');
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw bad(
        `Photo ${index + 1} is ${(file.size / (1024 * 1024)).toFixed(2)} MB. Keep each photo under ${limits.maxPhotoMb} MB.`,
      );
    }
    const bytes = await file.arrayBuffer();
    if (!looksLikeImage(new Uint8Array(bytes.slice(0, 12)), type)) {
      throw bad(`Photo ${index + 1} does not look like a real image file.`);
    }
    photos.push({ id: uid('pho'), bytes, mime: type, size: file.size, position: index });
  }

  const soundMode = String(form.get('soundMode') || 'none');
  let soundId: string | null = null;
  let newSound: { id: string; title: string; mime: string; bytes: ArrayBuffer; size: number; durationMs: number } | null =
    null;

  if (soundMode === 'library') {
    const requested = String(form.get('soundId') || '');
    if (!requested) throw bad('Choose a sound from the library, or post without audio.');
    await publicSoundUsable(env, requested, user.id);
    soundId = requested;
  } else if (soundMode === 'upload') {
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0) {
      throw bad('Attach an audio file, or post without audio.');
    }
    const type = audio.type || 'audio/mpeg';
    if (!AUDIO_TYPES.has(type)) {
      throw bad('Audio needs to be MP3, M4A, AAC, OGG or WAV.');
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      throw bad(`Audio files are limited to ${limits.maxAudioMb} MB.`);
    }
    const bytes = await audio.arrayBuffer();
    if (!looksLikeAudio(new Uint8Array(bytes.slice(0, 12)), type)) {
      throw bad('That audio file does not look like real audio.');
    }
    const durationRaw = Number(form.get('audioDurationMs') || 0);
    newSound = {
      id: uid('snd'),
      title: (optionalStr(form.get('soundTitle'), 60) || `${user.displayName}'s sound`).trim(),
      mime: type,
      bytes,
      size: audio.size,
      durationMs: Number.isFinite(durationRaw) ? Math.max(0, Math.min(600000, Math.round(durationRaw))) : 0,
    };
    soundId = newSound.id;
  }

  const postId = uid('pst');
  const createdAt = now();
  const hashtags = parseHashtags(caption);
  const statements = [];

  if (newSound) {
    statements.push(
      env.DB.prepare(
        'INSERT INTO sounds (id, owner_id, title, mime, bytes, size, duration_ms, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
      ).bind(
        newSound.id,
        user.id,
        newSound.title,
        newSound.mime,
        newSound.bytes,
        newSound.size,
        newSound.durationMs,
        createdAt,
      ),
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO posts (id, owner_id, caption, category, hashtags, sound_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(postId, user.id, caption, category, JSON.stringify(hashtags), soundId, createdAt, createdAt),
  );

  for (const photo of photos) {
    statements.push(
      env.DB.prepare(
        'INSERT INTO post_photos (id, post_id, position, mime, bytes, size, width, height) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)',
      ).bind(photo.id, postId, photo.position, photo.mime, photo.bytes, photo.size),
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO moderation_events (id, post_id, admin_id, action, reason, created_at)
       VALUES (?, ?, NULL, 'submit', NULL, ?)`,
    ).bind(uid('mod'), postId, createdAt),
  );

  await env.DB.batch(statements);

  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(postId).first<PostRow>();
  const [post] = await hydratePosts(env, origin, user.id, [row!]);
  return json({ post }, 201);
}

export async function updatePost(req: Request, env: Env, origin: string, id: string) {
  const user = await requireActive(req, env);
  const row = await env.DB.prepare('SELECT owner_id, status, caption, category FROM posts WHERE id = ?')
    .bind(id)
    .first<{ owner_id: string; status: string; caption: string; category: string }>();
  if (!row) throw missing('That post is not here.');
  if (row.owner_id !== user.id && user.role !== 'admin') throw denied('That post is not yours.');
  if (row.status === 'removed') throw bad('Removed posts cannot be edited.');

  const body = await readJson(req);
  const caption =
    body.caption !== undefined ? optionalStr(body.caption, limits.maxCaptionLength) || '' : row.caption;
  const category = body.category !== undefined ? String(body.category) : row.category;
  if (!categoryById.has(category)) throw bad('Pick a category for your post.');

  const changed = caption !== row.caption || category !== row.category;
  const needsReview = changed && (row.status === 'approved' || row.status === 'pending');
  await env.DB.prepare(
    `UPDATE posts SET caption = ?, category = ?, hashtags = ?, status = ?, updated_at = ?,
       reject_reason = CASE WHEN ? THEN NULL ELSE reject_reason END
     WHERE id = ?`,
  )
    .bind(
      caption,
      category,
      JSON.stringify(parseHashtags(caption)),
      needsReview ? 'pending' : row.status,
      now(),
      needsReview ? 1 : 0,
      id,
    )
    .run();

  if (changed) {
    await env.DB.prepare(
      `INSERT INTO moderation_events (id, post_id, admin_id, action, reason, created_at)
       VALUES (?, ?, NULL, 'resubmit', ?, ?)`,
    )
      .bind(uid('mod'), id, 'Creator edited the post', now())
      .run();
  }

  const updated = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first<PostRow>();
  const [post] = await hydratePosts(env, origin, user.id, [updated!]);
  return json({ post, needsReview });
}

export async function deletePost(req: Request, env: Env, id: string) {
  const user = await requireActive(req, env);
  const row = await env.DB.prepare('SELECT owner_id FROM posts WHERE id = ?')
    .bind(id)
    .first<{ owner_id: string }>();
  if (!row) throw missing('That post is not here.');
  if (row.owner_id !== user.id && user.role !== 'admin') throw denied('That post is not yours.');
  await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  invalidateTrending();
  return json({ ok: true });
}

export async function toggleLike(req: Request, env: Env, id: string) {
  const user = await requireActive(req, env);
  const post = await env.DB.prepare('SELECT id, status FROM posts WHERE id = ?')
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!post || post.status !== 'approved') throw missing('That post is not here.');

  const existing = await env.DB.prepare('SELECT 1 AS n FROM likes WHERE user_id = ? AND post_id = ?')
    .bind(user.id, id)
    .first<{ n: number }>();

  if (existing) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').bind(user.id, id),
      env.DB.prepare('UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id = ?').bind(id),
    ]);
    await applySignal(env, user.id, id, 'like', -1);
  } else {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)').bind(
        user.id,
        id,
        now(),
      ),
      env.DB.prepare('UPDATE posts SET like_count = like_count + 1 WHERE id = ?').bind(id),
    ]);
    await applySignal(env, user.id, id, 'like');
  }

  const count = await env.DB.prepare('SELECT like_count FROM posts WHERE id = ?')
    .bind(id)
    .first<{ like_count: number }>();
  return json({ liked: !existing, likeCount: count?.like_count ?? 0 });
}

export async function listComments(req: Request, env: Env, url: URL, id: string) {
  const viewer = await currentUser(req, env);
  const { offset, page } = pageOf(url.searchParams.get('page'), limits.commentsPageSize);
  const post = await env.DB.prepare('SELECT status, owner_id FROM posts WHERE id = ?')
    .bind(id)
    .first<{ status: string; owner_id: string }>();
  if (!post) throw missing('That post is not here.');
  if (post.status !== 'approved' && !(viewer && (viewer.id === post.owner_id || viewer.role === 'admin'))) {
    throw missing('That post is not here.');
  }

  const rows = await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, c.user_id, u.username, u.display_name, u.avatar_version
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? AND c.status = 'visible'
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(id, limits.commentsPageSize + 1, offset)
    .all<{
      id: string;
      body: string;
      created_at: number;
      user_id: string;
      username: string;
      display_name: string;
      avatar_version: number;
    }>();

  const list = rows.results || [];
  const hasMore = list.length > limits.commentsPageSize;
  const origin = new URL(req.url).origin;
  return json({
    comments: list.slice(0, limits.commentsPageSize).map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      author: {
        id: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: `${origin}/media/avatars/${row.user_id}?v=${row.avatar_version}`,
      },
      canDelete: Boolean(viewer && (viewer.id === row.user_id || viewer.role === 'admin')),
    })),
    hasMore,
    page,
  });
}

export async function addComment(req: Request, env: Env, id: string) {
  const user = await requireActive(req, env);
  await rateLimit(
    env,
    `comment:${user.id}`,
    limits.maxCommentsPerMinute,
    60 * 1000,
    'You are commenting quickly. Give it a minute.',
  );
  const body = await readJson(req);
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) throw bad('Write something first.');
  if (text.length > 400) throw bad('Comments are limited to 400 characters.');

  const post = await env.DB.prepare('SELECT id, owner_id, status FROM posts WHERE id = ?')
    .bind(id)
    .first<{ id: string; owner_id: string; status: string }>();
  if (!post || post.status !== 'approved') throw missing('That post is not here.');

  const blocked = await env.DB.prepare(
    `SELECT 1 AS n FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
  )
    .bind(post.owner_id, user.id, user.id, post.owner_id)
    .first<{ n: number }>();
  if (blocked) throw denied('You cannot comment on this post.');

  const commentId = uid('cmt');
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO comments (id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(commentId, id, user.id, text, now()),
    env.DB.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?').bind(id),
  ]);
  await applySignal(env, user.id, id, 'comment');

  if (post.owner_id !== user.id) {
    await env.DB.prepare(
      `INSERT INTO notifications (id, user_id, type, post_id, actor_id, detail, created_at)
       VALUES (?, ?, 'comment', ?, ?, ?, ?)`,
    )
      .bind(uid('ntf'), post.owner_id, id, user.id, text.slice(0, 120), now())
      .run();
  }

  const origin = new URL(req.url).origin;
  return json(
    {
      comment: {
        id: commentId,
        body: text,
        createdAt: now(),
        author: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: `${origin}/media/avatars/${user.id}?v=${user.avatarVersion}`,
        },
        canDelete: true,
      },
    },
    201,
  );
}

export async function deleteComment(req: Request, env: Env, id: string) {
  const user = await requireActive(req, env);
  const row = await env.DB.prepare('SELECT user_id, post_id FROM comments WHERE id = ?')
    .bind(id)
    .first<{ user_id: string; post_id: string }>();
  if (!row) throw missing();
  if (row.user_id !== user.id && user.role !== 'admin') throw denied('That comment is not yours.');
  await env.DB.batch([
    env.DB.prepare("UPDATE comments SET status = 'removed' WHERE id = ?").bind(id),
    env.DB.prepare('UPDATE posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?').bind(
      row.post_id,
    ),
  ]);
  return json({ ok: true });
}

export async function postEvent(req: Request, env: Env, id: string) {
  const viewer = await currentUser(req, env);
  const body = await readJson(req);
  const kind = String(body.kind || '');
  const post = await env.DB.prepare('SELECT id, status FROM posts WHERE id = ?')
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!post || post.status !== 'approved') throw missing();

  if (kind === 'view') {
    const recent = await env.DB.prepare(
      `SELECT 1 AS n FROM post_events WHERE user_id = ? AND post_id = ? AND kind = 'view' AND created_at > ?`,
    )
      .bind(viewer?.id ?? 'guest', id, now() - 3 * 60 * 60 * 1000)
      .first<{ n: number }>();
    if (!recent) {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO post_events (id, post_id, user_id, kind, value, created_at) VALUES (?, ?, ?, ?, 0, ?)',
        ).bind(uid('ev'), id, viewer?.id ?? 'guest', 'view', now()),
        env.DB.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').bind(id),
      ]);
    }
    return json({ ok: true });
  }

  if (!viewer) return json({ ok: true });
  if (kind === 'complete' || kind === 'rewatch' || kind === 'skip') {
    // Watching a post's photos: dwell time decides whether it counted or was a skip.
    await recordEvent(env, viewer.id, id, kind as 'complete' | 'rewatch' | 'skip');
    return json({ ok: true });
  }
  throw bad('Unknown event.');
}

export async function setNotInterested(req: Request, env: Env, id: string, hide: boolean) {
  const user = await requireActive(req, env);
  const post = await env.DB.prepare('SELECT category, hashtags FROM posts WHERE id = ?')
    .bind(id)
    .first<{ category: string; hashtags: string }>();
  if (!post) throw missing();

  if (hide) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO hidden_posts (user_id, post_id, created_at) VALUES (?, ?, ?)',
    )
      .bind(user.id, id, now())
      .run();
    await recordEvent(env, user.id, id, 'not_interested');
  } else {
    await env.DB.prepare('DELETE FROM hidden_posts WHERE user_id = ? AND post_id = ?')
      .bind(user.id, id)
      .run();
    await undoEvent(env, user.id, id, 'not_interested');
  }
  return json({ hidden: hide });
}

export async function categoryPosts(req: Request, env: Env, origin: string, url: URL, id: string) {
  if (!categoryById.has(id)) throw missing('That category does not exist.');
  const viewer = await currentUser(req, env);
  const { offset, page } = pageOf(url.searchParams.get('page'), 12);
  const rows = await env.DB.prepare(
    `${POST_SELECT}
      WHERE p.status = 'approved' AND u.status = 'active' AND p.category = ?
      ORDER BY p.published_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(id, 13, offset)
    .all<PostRow>();
  const list = rows.results || [];
  const items = await hydratePosts(env, origin, viewer?.id ?? null, list.slice(0, 12));
  return json({ items, hasMore: list.length > 12, page });
}

export async function soundLibrary(req: Request, env: Env, url: URL) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const { offset, page } = pageOf(url.searchParams.get('page'), 20);
  const origin = new URL(req.url).origin;
  const viewer = await currentUser(req, env);

  const rows = await env.DB.prepare(
    `SELECT s.id, s.title, s.duration_ms, s.use_count, s.owner_id,
            u.username, u.display_name,
            (SELECT COUNT(*) FROM posts p WHERE p.sound_id = s.id AND p.status = 'approved') AS live
       FROM sounds s JOIN users u ON u.id = s.owner_id
      WHERE (s.owner_id = ? OR EXISTS(SELECT 1 FROM posts p WHERE p.sound_id = s.id AND p.status = 'approved'))
        AND (? = '' OR LOWER(s.title) LIKE ? OR LOWER(u.username) LIKE ?)
      ORDER BY live DESC, s.use_count DESC, s.created_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(
      viewer?.id ?? '',
      q,
      `%${q}%`,
      `%${q}%`,
      21,
      offset,
    )
    .all<{
      id: string;
      title: string;
      duration_ms: number;
      use_count: number;
      owner_id: string;
      username: string;
      display_name: string;
    }>();

  const list = rows.results || [];
  return json({
    sounds: list.slice(0, 20).map((row) => ({
      id: row.id,
      title: row.title,
      url: `${origin}/media/sounds/${row.id}`,
      durationMs: row.duration_ms,
      useCount: row.use_count,
      owner: { id: row.owner_id, username: row.username, displayName: row.display_name },
      isMine: viewer?.id === row.owner_id,
    })),
    hasMore: list.length > 20,
    page,
  });
}

export async function reportPost(req: Request, env: Env, id: string) {
  const user = await requireActive(req, env);
  await rateLimit(env, `report:${user.id}`, 10, 60 * 60 * 1000, 'You have reported a lot recently.');
  const body = await readJson(req);
  const reason = String(body.reason || '');
  if (!postReportReasons.includes(reason)) throw bad('Pick a reason for the report.');
  const note = optionalStr(body.note, 400);
  const post = await env.DB.prepare('SELECT id FROM posts WHERE id = ?').bind(id).first<{ id: string }>();
  if (!post) throw missing();

  const existing = await env.DB.prepare(
    "SELECT id FROM reports WHERE reporter_id = ? AND target_type = 'post' AND target_id = ? AND status = 'open'",
  )
    .bind(user.id, id)
    .first<{ id: string }>();
  if (existing) throw bad('You already reported this post. The moderator can see it.');

  await env.DB.prepare(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, note, created_at)
     VALUES (?, ?, 'post', ?, ?, ?, ?)`,
  )
    .bind(uid('rep'), user.id, id, reason, note, now())
    .run();
  return json({ ok: true }, 201);
}

export async function reportComment(req: Request, env: Env, id: string) {
  const user = await requireActive(req, env);
  const body = await readJson(req);
  const reason = String(body.reason || '');
  if (!postReportReasons.includes(reason) && reason !== 'Spam') {
    throw bad('Pick a reason for the report.');
  }
  const note = optionalStr(body.note, 400);
  const comment = await env.DB.prepare('SELECT id FROM comments WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (!comment) throw missing();
  await env.DB.prepare(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, note, created_at)
     VALUES (?, ?, 'comment', ?, ?, ?, ?)`,
  )
    .bind(uid('rep'), user.id, id, reason, note, now())
    .run();
  return json({ ok: true }, 201);
}

export async function myPosts(req: Request, env: Env, origin: string, url: URL, username?: string) {
  const viewer = await currentUser(req, env);
  const { offset, page } = pageOf(url.searchParams.get('page'), 12);
  const target = username
    ? await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first<{ id: string }>()
    : viewer;
  if (!target) throw missing('No creator with that username.');
  const isSelf = viewer?.id === target.id;

  const rows = await env.DB.prepare(
    `${POST_SELECT}
      WHERE p.owner_id = ?
        AND (p.status = 'approved' OR (p.owner_id = ? AND ? = 1))
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(
      target.id,
      viewer?.id ?? '',
      isSelf || viewer?.role === 'admin' ? 1 : 0,
      13,
      offset,
    )
    .all<PostRow>();

  const list = rows.results || [];
  const items = await hydratePosts(env, origin, viewer?.id ?? null, list.slice(0, 12));
  return json({ items, hasMore: list.length > 12, page });
}
