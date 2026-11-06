import type { VideoDTO, VideoStatus } from '../shared/types.ts';
import { categoryById, publicUrl } from './config.ts';

export interface VideoRow {
  id: string;
  owner_id: string;
  caption: string;
  category: string;
  hashtags: string;
  file_name: string;
  mime: string;
  poster_name: string | null;
  duration: number;
  width: number | null;
  height: number | null;
  size_bytes: number;
  status: VideoStatus;
  reject_reason: string | null;
  removed_reason: string | null;
  credit: string | null;
  created_at: number;
  updated_at: number;
  published_at: number | null;
  view_count: number;
  seed: number;
  owner_username: string;
  owner_name: string;
  owner_avatar: string | null;
  owner_status: string;
  like_count: number;
  comment_count: number;
  liked: number;
  following_owner: number;
  my_watch: number | null;
}

/**
 * Placeholders in the SELECT list are (viewerId, viewerId, viewerId).
 * Callers append their own WHERE parameters.
 */
export const VIDEO_SELECT = `
SELECT v.*, u.username AS owner_username, u.display_name AS owner_name,
  u.avatar_url AS owner_avatar, u.status AS owner_status,
  (SELECT COUNT(*) FROM likes l WHERE l.video_id = v.id) AS like_count,
  (SELECT COUNT(*) FROM comments c WHERE c.video_id = v.id AND c.status = 'visible') AS comment_count,
  EXISTS(SELECT 1 FROM likes lv WHERE lv.video_id = v.id AND lv.user_id = ?) AS liked,
  EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = v.owner_id) AS following_owner,
  (SELECT MAX(watch_seconds) FROM video_views w WHERE w.video_id = v.id AND w.user_id = ?) AS my_watch
FROM videos v
JOIN users u ON u.id = v.owner_id
`;

export function rowToVideo(row: VideoRow, viewerId: string | null, reason: string | null = null): VideoDTO {
  const creatorIsSelf = row.owner_id === viewerId;
  return {
    id: row.id,
    caption: row.caption,
    category: row.category,
    categoryLabel: categoryById.get(row.category)?.label ?? row.category,
    hashtags: parseTags(row.hashtags),
    duration: Number(row.duration) || 0,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    viewCount: row.view_count,
    likeCount: Number(row.like_count) || 0,
    commentCount: Number(row.comment_count) || 0,
    liked: Boolean(row.liked),
    status: row.status,
    rejectReason: row.status === 'removed' ? row.removed_reason : row.reject_reason,
    posterUrl: row.poster_name ? publicUrl(`/media/posters/${row.id}`) : null,
    videoUrl: publicUrl(`/media/videos/${row.id}`) ?? '',
    width: row.width,
    height: row.height,
    creator: {
      id: row.owner_id,
      username: row.owner_username,
      displayName: row.owner_name,
      avatarUrl: publicUrl(row.owner_avatar),
      isFollowing: Boolean(row.following_owner),
      isSelf: creatorIsSelf,
    },
    reason,
    credit: row.credit,
    watchProgress: row.my_watch && row.duration > 0 ? Math.min(1, Number(row.my_watch) / Number(row.duration)) : null,
  };
}

export function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}
