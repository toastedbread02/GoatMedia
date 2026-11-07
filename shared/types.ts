// Types shared by the API and the browser app.

import type { ContactCategory } from './policy.ts';

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
  saved: boolean;
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
  /** True for the moderator's pick of the day, pinned above For You. */
  goatOfDay?: boolean;
  /** Calendar day of that pick, on the archive list. */
  day?: string | null;
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

export type NotificationType =
  | 'approved'
  | 'rejected'
  | 'follow'
  | 'comment'
  | 'like'
  | 'new_post'
  | 'removed'
  | 'support'
  | 'milestone'
  | 'weekly'
  | 'warning'
  | 'ban'
  | 'appeal';

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  createdAt: number;
  read: boolean;
  /** True when this comment notification answers the reader's own comment. */
  isReply: boolean;
  /** Set only on moderator notifications about a contact request. */
  ticketId: string | null;
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
  /** Username when the report points at an account. */
  userTarget?: string | null;
}

export interface AdminUserRow {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: string;
  status: 'active' | 'suspended' | 'deleted';
  suspendedReason: string | null;
  deletedAt: number | null;
  deletedReason: string | null;
  createdAt: number;
  videoCount: number;
  followerCount: number;
  /** Warnings that still count: an accepted appeal removes one. */
  warningCount: number;
}

export interface ModerationCounts {
  pending: number;
  approved: number;
  rejected: number;
  removed: number;
  openReports: number;
  openTickets: number;
  openAppeals: number;
  users: number;
  newUsersThisWeek: number;
}

/** An appeal as the moderator queue sees it. */
export interface AppealDTO {
  id: string;
  kind: 'ban' | 'warning';
  reason: string;
  status: 'sent' | 'open' | 'accepted' | 'declined';
  message: string | null;
  createdAt: number;
  submittedAt: number | null;
  username: string;
  displayName: string;
  email: string;
  accountStatus: string;
  warningCount: number;
  /** Whether the notice email actually left the building. */
  mailStatus: 'sent' | 'failed' | 'skipped' | null;
}

/** What the public appeal page is allowed to know about its link. */
export interface AppealLinkDTO {
  kind: 'ban' | 'warning';
  reason: string;
  status: 'sent' | 'open' | 'accepted' | 'declined';
  submittedAt: number | null;
  createdAt: number;
  resolvedAt: number | null;
  decisionNote: string | null;
  username: string;
  warnings: number;
  accountStatus: string;
}

export interface SupportTicketDTO {
  id: string;
  category: ContactCategory;
  categoryLabel: string;
  email: string;
  targetUsername: string | null;
  body: string;
  device: string;
  pageUrl: string | null;
  status: 'open' | 'reviewing' | 'closed';
  createdAt: number;
  resolvedAt: number | null;
  resolutionNote: string | null;
  reporter: { id: string; username: string; displayName: string } | null;
  targetAccount: {
    id: string;
    username: string;
    displayName: string;
    status: 'active' | 'suspended' | 'deleted';
  } | null;
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

export interface CreatorStatsDTO {
  week: { views: number; likes: number; comments: number; followers: number };
  previous: { views: number; likes: number; comments: number; followers: number };
  /** Views per day, oldest first, ending today. */
  daily: number[];
  topPost: { id: string; caption: string; views: number } | null;
  totals: { posts: number; views: number; likes: number };
}

export interface SearchResults {
  videos: VideoDTO[];
  creators: PublicUser[];
  hashtag: string | null;
  query: string;
}

export interface StorageRow {
  kind: 'videos' | 'photos' | 'sounds' | 'avatars' | 'posters';
  bytes: number;
  count: number;
}

export interface StorageDatabase {
  id: string;
  label: string;
  detail: string;
  usedBytes: number;
  limitBytes: number;
  /** The shard the next upload will be written to. */
  active: boolean;
}

export interface StorageDTO {
  limitBytes: number;
  /** Free space summed across every database. */
  leftBytes: number;
  /** Databases holding at least one byte. */
  inUse: number;
  databaseList: StorageDatabase[];
  usedBytes: number;
  /** Share of the limit in use, 0 to 100. */
  percent: number;
  /** Share at which the panel starts warning, 0 to 1. */
  warnAt: number;
  averageVideoBytes: number;
  breakdown: StorageRow[];
  /** Rejected and removed posts whose media could still be deleted. */
  reclaimable: { posts: number; videos: number; bytes: number };
}

export interface PurgeResult {
  posts: number;
  videos: number;
  freedBytes: number;
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

export interface TrafficDayDTO {
  /** UTC day, `YYYY-MM-DD`. */
  date: string;
  visits: number;
  views: number;
  signups: number;
}

export interface TrafficDTO {
  days: number;
  series: TrafficDayDTO[];
  sources: { source: string; visits: number }[];
  totals: {
    visits: number;
    views: number;
    signups: number;
    visitors: number;
    /** Distinct visitors over the last seven days. */
    weekVisitors: number;
    /** Those who appeared on two or more different days in that week. */
    returning: number;
  };
}
