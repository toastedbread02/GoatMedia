// Row -> DTO mapping. Everything the browser renders is assembled here so the
// shape stays identical across feeds, profiles, search and the moderation queue.

import { Env } from './lib';
import { categoryById } from './config';

export interface PostRow {
  id: string;
  owner_id: string;
  caption: string;
  category: string;
  hashtags: string;
  sound_id: string | null;
  kind: 'video' | 'photos';
  duration_ms: number;
  width: number | null;
  height: number | null;
  video_upload_id: string | null;
  has_poster: number;
  status: 'pending' | 'approved' | 'rejected' | 'removed';
  reject_reason: string | null;
  removed_reason: string | null;
  created_at: number;
  updated_at: number;
  published_at: number | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  username: string;
  display_name: string;
  avatar_version: number;
  has_avatar: number;
  owner_status: string;
  owner_role: string;
}

export const POST_SELECT = `
  SELECT p.id, p.owner_id, p.caption, p.category, p.hashtags, p.sound_id, p.status,
         p.kind, p.duration_ms, p.width, p.height, p.video_upload_id,
         p.reject_reason, p.removed_reason, p.created_at, p.updated_at, p.published_at,
         p.view_count, p.like_count, p.comment_count,
         (SELECT 1 FROM uploads up WHERE up.id = p.video_upload_id AND up.poster_bytes IS NOT NULL) AS has_poster,
         u.username, u.display_name, u.avatar_version,
         (u.avatar_bytes IS NOT NULL) AS has_avatar, u.status AS owner_status, u.role AS owner_role
    FROM posts p JOIN users u ON u.id = p.owner_id`;

export function avatarUrl(
  origin: string,
  userId: string,
  version: number,
  hasAvatar: boolean | number,
): string | null {
  if (!hasAvatar) return null;
  return `${origin}/media/avatars/${userId}?v=${version}`;
}

interface PhotoRow {
  id: string;
  post_id: string;
  position: number;
  width: number | null;
  height: number | null;
}

interface SoundJoinRow {
  id: string;
  owner_id: string;
  title: string;
  duration_ms: number;
  use_count: number;
  username: string;
  display_name: string;
}

export interface PostDTO {
  id: string;
  kind: 'video' | 'photos';
  caption: string;
  category: string;
  categoryLabel: string;
  hashtags: string[];
  duration: number;
  createdAt: number;
  publishedAt: number | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  notInterested: boolean;
  status: string;
  rejectReason: string | null;
  removedReason: string | null;
  videoUrl: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  credit: string | null;
  watchProgress: number | null;
  photos: { id: string; url: string; width: number | null; height: number | null }[];
  sound: {
    id: string;
    title: string;
    url: string;
    durationMs: number;
    useCount: number;
    owner: { id: string; username: string; displayName: string };
  } | null;
  creator: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    isSelf: boolean;
    isFollowing: boolean;
    isBlocked: boolean;
    isModerator: boolean;
  };
  reason: string | null;
}

function parseHashtags(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export async function hydratePosts(
  env: Env,
  origin: string,
  viewerId: string | null,
  rows: PostRow[],
  options: { showStatus?: boolean } = {},
): Promise<PostDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');

  const [photoRes, soundRes, likeRes, hiddenRes, followRes, blockRes] = await Promise.all([
    env.DB.prepare(
      `SELECT id, post_id, position, width, height FROM post_photos
        WHERE post_id IN (${placeholders}) ORDER BY post_id, position`,
    )
      .bind(...ids)
      .all<PhotoRow>(),
    env.DB.prepare(
      `SELECT s.id, s.owner_id, s.title, s.duration_ms, s.use_count, u.username, u.display_name
         FROM sounds s JOIN users u ON u.id = s.owner_id
        WHERE s.id IN (${rows
          .map(() => '?')
          .join(',')})`,
    )
      .bind(...rows.map((r) => r.sound_id || 'none'))
      .all<SoundJoinRow>(),
    viewerId
      ? env.DB.prepare(`SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${placeholders})`)
          .bind(viewerId, ...ids)
          .all<{ post_id: string }>()
      : Promise.resolve({ results: [] as { post_id: string }[] }),
    viewerId
      ? env.DB.prepare(
          `SELECT post_id FROM hidden_posts WHERE user_id = ? AND post_id IN (${placeholders})`,
        )
          .bind(viewerId, ...ids)
          .all<{ post_id: string }>()
      : Promise.resolve({ results: [] as { post_id: string }[] }),
    viewerId
      ? env.DB.prepare(
          `SELECT following_id FROM follows WHERE follower_id = ? AND following_id IN (${rows
            .map(() => '?')
            .join(',')})`,
        )
          .bind(viewerId, ...rows.map((r) => r.owner_id))
          .all<{ following_id: string }>()
      : Promise.resolve({ results: [] as { following_id: string }[] }),
    viewerId
      ? env.DB.prepare(
          `SELECT blocked_id FROM blocks WHERE blocker_id = ? AND blocked_id IN (${rows
            .map(() => '?')
            .join(',')})`,
        )
          .bind(viewerId, ...rows.map((r) => r.owner_id))
          .all<{ blocked_id: string }>()
      : Promise.resolve({ results: [] as { blocked_id: string }[] }),
  ]);

  const photosByPost = new Map<string, PostDTO['photos']>();
  for (const photo of photoRes.results || []) {
    const list = photosByPost.get(photo.post_id) || [];
    list.push({
      id: photo.id,
      url: `${origin}/media/photos/${photo.id}`,
      width: photo.width,
      height: photo.height,
    });
    photosByPost.set(photo.post_id, list);
  }

  const sounds = new Map((soundRes.results || []).map((s) => [s.id, s]));
  const liked = new Set((likeRes.results || []).map((r) => r.post_id));
  const hidden = new Set((hiddenRes.results || []).map((r) => r.post_id));
  const following = new Set((followRes.results || []).map((r) => r.following_id));
  const blocked = new Set((blockRes.results || []).map((r) => r.blocked_id));

  return rows.map((row) => {
    const category = categoryById.get(row.category);
    const kind: 'video' | 'photos' = row.kind === 'video' ? 'video' : 'photos';
    const photos = photosByPost.get(row.id) || [];
    // A borrowed sound belongs to photo albums; a video carries its own audio.
    const sound = kind === 'photos' && row.sound_id ? sounds.get(row.sound_id) : undefined;
    const posterUrl =
      kind === 'video'
        ? row.has_poster
          ? `${origin}/media/posters/${row.id}`
          : null
        : photos[0]?.url ?? null;
    return {
      id: row.id,
      kind,
      caption: row.caption,
      category: row.category,
      categoryLabel: category?.label || row.category,
      hashtags: parseHashtags(row.hashtags),
      duration: Math.round((row.duration_ms || 0) / 100) / 10,
      createdAt: row.created_at,
      publishedAt: row.published_at,
      viewCount: row.view_count,
      likeCount: row.like_count,
      commentCount: row.comment_count,
      liked: liked.has(row.id),
      notInterested: hidden.has(row.id),
      status: row.status,
      rejectReason: row.reject_reason,
      removedReason: row.removed_reason,
      videoUrl: kind === 'video' ? `${origin}/media/videos/${row.id}` : null,
      posterUrl,
      width: row.width ?? photos[0]?.width ?? null,
      height: row.height ?? photos[0]?.height ?? null,
      credit: null,
      watchProgress: null,
      photos,
      sound: sound
        ? {
            id: sound.id,
            title: sound.title,
            url: `${origin}/media/sounds/${sound.id}`,
            durationMs: sound.duration_ms,
            useCount: sound.use_count,
            owner: {
              id: sound.owner_id,
              username: sound.username,
              displayName: sound.display_name,
            },
          }
        : null,
      creator: {
        id: row.owner_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: avatarUrl(origin, row.owner_id, row.avatar_version, Boolean(row.has_avatar)),
        isSelf: viewerId === row.owner_id,
        isFollowing: following.has(row.owner_id),
        isBlocked: blocked.has(row.owner_id),
        isModerator: row.owner_role === 'admin',
      },
      reason: null,
    };
  });
}

export interface UserRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  bio: string;
  role: string;
  status: string;
  suspended_reason: string | null;
  avatar_version: number;
  has_avatar: number;
  created_at: number;
  follower_count: number;
  following_count: number;
  post_count: number;
  is_following: number;
  is_blocked: number;
}

export function publicUser(origin: string, row: UserRow, viewerId: string | null) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: avatarUrl(origin, row.id, row.avatar_version, Boolean(row.has_avatar)),
    createdAt: row.created_at,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    videoCount: row.post_count,
    postCount: row.post_count,
    isFollowing: Boolean(row.is_following),
    isSelf: viewerId === row.id,
    isBlocked: Boolean(row.is_blocked),
    status: row.status === 'suspended' ? 'suspended' : 'active',
  };
}

export const USER_SELECT = (viewerId: string | null) => `
  SELECT u.id, u.email, u.username, u.display_name, u.bio, u.role, u.status,
         u.suspended_reason, u.avatar_version, (u.avatar_bytes IS NOT NULL) AS has_avatar, u.created_at,
         (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count,
         (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
         (SELECT COUNT(*) FROM posts p WHERE p.owner_id = u.id AND p.status = 'approved') AS post_count,
         EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId ? '?' : 'NULL'} AND f.following_id = u.id) AS is_following,
         EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id = ${viewerId ? '?' : 'NULL'} AND b.blocked_id = u.id) AS is_blocked
    FROM users u`;
