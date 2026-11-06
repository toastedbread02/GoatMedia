// Types shared by the API and the browser app.

export type VideoStatus = 'pending' | 'approved' | 'rejected' | 'removed';

export interface Category {
  id: string;
  label: string;
  blurb: string;
}

export interface CreatorSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isFollowing: boolean;
  isSelf: boolean;
}

export interface VideoDTO {
  id: string;
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
  status: VideoStatus;
  rejectReason: string | null;
  posterUrl: string | null;
  videoUrl: string;
  width: number | null;
  height: number | null;
  creator: CreatorSummary;
  reason: string | null;
  credit: string | null;
  watchProgress: number | null;
}

export interface CommentDTO {
  id: string;
  body: string;
  createdAt: number;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  canDelete: boolean;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  createdAt: number;
  followerCount: number;
  followingCount: number;
  videoCount: number;
  isFollowing: boolean;
  isSelf: boolean;
  isBlocked: boolean;
  status: 'active' | 'suspended';
}

export interface MeDTO extends PublicUser {
  email: string;
  role: 'user' | 'admin';
  unreadNotifications: number;
}

export interface FeedResponse {
  items: VideoDTO[];
  hasMore: boolean;
  page: number;
}

export interface AppConfigDTO {
  limits: {
    maxUploadMb: number;
    maxDurationSeconds: number;
    minDurationSeconds: number;
    maxAvatarMb: number;
    maxCaptionLength: number;
    maxCommentsPerMinute: number;
  };
  categories: Category[];
  moderation: 'manual';
  resetLinkExposed: boolean;
  reportReasons: { video: string[]; comment: string[] };
  rejectReasons: string[];
  guidelines: string[];
}

export type NotificationType = 'approved' | 'rejected' | 'follow' | 'comment' | 'removed';

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  createdAt: number;
  read: boolean;
  videoId: string | null;
  videoCaption: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
  detail: string | null;
}

export interface AdminQueueItem extends VideoDTO {
  creatorEmail: string;
  creatorJoinedAt: number;
  creatorUploads: number;
  moderationHistory: ModerationEventDTO[];
}

export interface ModerationEventDTO {
  id: string;
  action: 'submit' | 'approve' | 'reject' | 'remove' | 'resubmit';
  reason: string | null;
  createdAt: number;
  adminUsername: string | null;
}

export interface ReportDTO {
  id: string;
  targetType: 'video' | 'comment' | 'user';
  targetId: string;
  reason: string;
  note: string | null;
  createdAt: number;
  status: 'open' | 'dismissed' | 'actioned';
  reporterUsername: string;
  video: {
    id: string;
    caption: string;
    posterUrl: string | null;
    videoUrl: string;
    status: VideoStatus;
    creatorUsername: string;
  } | null;
  comment: { id: string; body: string; authorUsername: string; videoId: string; status: string } | null;
}

export interface AdminUserRow {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: string;
  status: 'active' | 'suspended';
  suspendedReason: string | null;
  createdAt: number;
  videoCount: number;
  followerCount: number;
}

export interface ModerationCounts {
  pending: number;
  approved: number;
  rejected: number;
  removed: number;
  openReports: number;
}

export interface SearchResults {
  videos: VideoDTO[];
  creators: PublicUser[];
  hashtag: string | null;
}

export interface InterestView {
  kind: 'category' | 'hashtag';
  value: string;
  weight: number;
  updatedAt: number;
}
