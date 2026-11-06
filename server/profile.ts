import type { MeDTO, PublicUser } from '../shared/types.ts';
import { get } from './db.ts';

interface UserCountRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  created_at: number;
  follower_count: number;
  following_count: number;
  video_count: number;
}

const USER_SELECT = `
SELECT u.id, u.email, u.username, u.display_name, u.bio, u.avatar_url, u.role, u.status, u.created_at,
  (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count,
  (SELECT COUNT(*) FROM follows f2 WHERE f2.follower_id = u.id) AS following_count,
  (SELECT COUNT(*) FROM videos v WHERE v.owner_id = u.id AND v.status = 'approved') AS video_count
FROM users u
`;

export function getPublicUser(username: string, viewerId: string | null): PublicUser | null {
  const row = get<UserCountRow>(`${USER_SELECT} WHERE lower(u.username) = lower(?)`, username);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    videoCount: row.video_count,
    isFollowing: viewerId
      ? Boolean(get(`SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?`, viewerId, row.id))
      : false,
    isSelf: viewerId === row.id,
    isBlocked: viewerId
      ? Boolean(get(`SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, viewerId, row.id))
      : false,
    status: row.status,
  };
}

export function getMe(userId: string): MeDTO | null {
  const row = get<UserCountRow>(`${USER_SELECT} WHERE u.id = ?`, userId);
  if (!row) return null;
  const unread = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    userId,
  );
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    videoCount: row.video_count,
    isFollowing: false,
    isSelf: true,
    isBlocked: false,
    unreadNotifications: unread?.n ?? 0,
  };
}
