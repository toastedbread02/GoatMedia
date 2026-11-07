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
  isBlocked: boolean;
  isModerator: boolean;
}

export interface PhotoRef {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface SoundRef {
  id: string;
  title: string;
  url: string;
  durationMs: number;
  useCount: number;
  owner: { id: string; username: string; displayName: string };
}

/** A post is a goat video or an album of goat photos. */
export type MediaKind = 'video' | 'photos';

export interface VideoDTO {
  id: string;
  kind: MediaKind;
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
  removedReason: string | null;
  posterUrl: string | null;
  videoUrl: string | null;
  photos: PhotoRef[];
  sound: SoundRef | null;
  width: number | null;
  height: number | null;
  creator: CreatorSummary;
  reason: string | null;
  credit: string | null;
  watchProgress: number | null;
  notInterested: boolean;
}

export interface CommentDTO {
  id: string;
  body: string;
  createdAt: number;
  /** Null for a top-level comment; the thread's root id for a reply. */
  parentId: string | null;
  likeCount: number;
  liked: boolean;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    isModerator: boolean;
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
  /** True when the account keeps its follower and following lists to itself. */
  followsPrivate?: boolean;
  isFollowing: boolean;
  isSelf: boolean;
  isBlocked: boolean;
  status: 'active' | 'suspended';
}

export interface MeDTO extends PublicUser {
  email: string;
  role: 'user' | 'admin';
  unreadNotifications: number;
  suspendedReason: string | null;
  /** YYYY-MM-DD, private to the account holder. */
  birthDate: string | null;
  hideFollows: boolean;
  searchable: boolean;
}

export interface FeedResponse {
  items: VideoDTO[];
  hasMore: boolean;
  page: number;
  requiresSignIn?: boolean;
  suspended?: boolean;
}

export interface AppConfigDTO {
  limits: {
    maxUploadMb: number;
    maxVideoMb: number;
    maxDurationSeconds: number;
    minDurationSeconds: number;
    maxPhotos: number;
    maxPhotoMb: number;
    maxAudioMb: number;
    maxAvatarMb: number;
    maxCaptionLength: number;
    maxCommentsPerMinute: number;
    minAge: number;
  };
  categories: Category[];
  moderation: 'manual';
  resetLinkExposed: boolean;
  reportReasons: { video: string[]; post: string[]; comment: string[] };
  rejectReasons: string[];
  guidelines: string[];
  /** True while this server still has no moderator, so the first account can claim it. */
  adminClaimable: boolean;
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
    kind: MediaKind;
    posterUrl: string | null;
    videoUrl: string | null;
    status: VideoStatus;
    creatorUsername: string;
  } | null;
  post: {
    id: string;
    caption: string;
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
  users: number;
  newUsersThisWeek: number;
}

export interface ModerationHistoryEntry extends ModerationEventDTO {
  adminId: string | null;
}

export interface AdminVideoDetail {
  video: AdminQueueItem;
  history: ModerationEventDTO[];
  reports: {
    id: string;
    reason: string;
    note: string | null;
    createdAt: number;
    status: string;
    reporterUsername: string;
  }[];
  rejectionReasons: string[];
}

export interface SearchResults {
  videos: VideoDTO[];
  creators: PublicUser[];
  hashtag: string | null;
  query: string;
}

export interface InterestView {
  kind: 'category' | 'hashtag';
  value: string;
  weight: number;
  updatedAt: number;
}

export interface SoundLibraryItem {
  id: string;
  title: string;
  url: string;
  durationMs: number;
  useCount: number;
  postCount: number;
  createdAt: number;
  owner: { id: string; username: string; displayName: string };
}
