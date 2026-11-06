// Shapes returned by the GoatMedia API. The Worker in /worker is the source of
// truth; these mirror its DTOs so the browser build stays typed end to end.

export type PostStatus = 'pending' | 'approved' | 'rejected' | 'removed';

export interface Category {
  id: string;
  label: string;
  blurb: string;
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

export interface CreatorSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isSelf: boolean;
  isFollowing: boolean;
  isBlocked: boolean;
}

export interface PostDTO {
  id: string;
  caption: string;
  category: string;
  categoryLabel: string;
  hashtags: string[];
  createdAt: number;
  publishedAt: number | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  notInterested: boolean;
  status: PostStatus;
  rejectReason: string | null;
  removedReason: string | null;
  photos: PhotoRef[];
  sound: SoundRef | null;
  creator: CreatorSummary;
  reason: string | null;
}

export interface CommentDTO {
  id: string;
  body: string;
  createdAt: number;
  author: { id: string; username: string; displayName: string; avatarUrl: string | null };
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
  postCount: number;
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
}

export interface FeedResponse {
  items: PostDTO[];
  hasMore: boolean;
  page: number;
  requiresSignIn?: boolean;
  suspended?: boolean;
}

export interface AppConfigDTO {
  limits: {
    maxPhotos: number;
    maxPhotoMb: number;
    maxAudioMb: number;
    maxAvatarMb: number;
    maxCaptionLength: number;
    maxBioLength: number;
    maxCommentsPerMinute: number;
  };
  categories: Category[];
  moderation: 'manual';
  reportReasons: { post: string[]; comment: string[] };
  rejectReasons: string[];
  guidelines: string[];
  passwordReset: 'link-on-screen';
}

export interface ModerationEvent {
  id: string;
  action: 'submit' | 'approve' | 'reject' | 'remove' | 'resubmit';
  reason: string | null;
  createdAt: number;
  adminUsername: string | null;
}

export interface AdminQueueItem extends PostDTO {
  creatorEmail: string;
  creatorJoinedAt: number;
  creatorPostCount: number;
}

export interface AdminPostDetail {
  post: AdminQueueItem;
  history: ModerationEvent[];
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

export interface ModerationCounts {
  pending: number;
  approved: number;
  rejected: number;
  removed: number;
  openReports: number;
  users: number;
  newUsersThisWeek: number;
}

export interface AdminReport {
  id: string;
  targetType: 'post' | 'comment' | 'user';
  targetId: string;
  reason: string;
  note: string | null;
  createdAt: number;
  status: string;
  reporterUsername: string;
  post: { id: string; caption: string; status: string; creatorUsername: string } | null;
  comment: { body: string; postId: string; authorUsername: string } | null;
  userTarget: string | null;
}

export interface AdminUserRow {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  suspendedReason: string | null;
  createdAt: number;
  postCount: number;
  followerCount: number;
}

export interface NotificationDTO {
  id: string;
  type: 'approved' | 'rejected' | 'removed' | 'follow' | 'comment';
  postId: string | null;
  postCaption: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
  detail: string | null;
  createdAt: number;
  read: boolean;
}

export interface InterestView {
  kind: 'category' | 'hashtag';
  value: string;
  weight: number;
  updatedAt: number;
}

export interface SearchResults {
  posts: PostDTO[];
  creators: PublicUser[];
  hashtag: string | null;
  query: string;
}

export interface SoundLibraryItem extends SoundRef {
  isMine: boolean;
}
