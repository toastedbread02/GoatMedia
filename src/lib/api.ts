// One place that talks to the Worker. The site is static (GitHub Pages) and the
// API lives on Cloudflare, so every call is absolute and authenticated with a
// bearer token kept in localStorage.

import type {
  AdminPostDetail,
  AdminQueueItem,
  AdminReport,
  AdminUserRow,
  AppConfigDTO,
  CommentDTO,
  FeedResponse,
  InterestView,
  MeDTO,
  ModerationCounts,
  NotificationDTO,
  PostDTO,
  PublicUser,
  SearchResults,
  SoundLibraryItem,
} from '../../shared/types';

const FALLBACK = 'http://127.0.0.1:8787';

declare global {
  interface Window {
    __GOAT_API__?: string;
  }
}

export const API_BASE = (
  import.meta.env.VITE_API_ORIGIN ||
  (typeof window !== 'undefined' ? window.__GOAT_API__ : '') ||
  FALLBACK
).replace(/\/+$/, '');

const TOKEN_KEY = 'goatmedia.token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode */
    }
  },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function handle<T>(response: Response): Promise<T> {
  const type = response.headers.get('content-type') || '';
  if (!response.ok) {
    let message = 'Something went wrong. Try again.';
    if (type.includes('application/json')) {
      const body = await response.json().catch(() => null);
      if (body?.error) message = body.error;
    }
    if (response.status === 401) message = message || 'Sign in to continue.';
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  return handle<T>(response);
}

function upload<T>(path: string, form: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const type = xhr.getResponseHeader('content-type') || '';
      const body = type.includes('application/json') ? JSON.parse(xhr.responseText || '{}') : null;
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(body as T);
      } else {
        reject(new ApiError(xhr.status, body?.error || 'That upload did not go through.'));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'The upload was interrupted. Check your connection.'));
    xhr.send(form);
  });
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  config: () => request<AppConfigDTO>('/api/config'),

  register: (input: { email: string; username: string; displayName: string; password: string }) =>
    request<{ token: string; user: MeDTO }>('/api/auth/register', {
      method: 'POST',
      body: json(input),
    }),
  login: (identifier: string, password: string) =>
    request<{ token: string; user: MeDTO }>('/api/auth/login', {
      method: 'POST',
      body: json({ identifier, password }),
    }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: MeDTO | null }>('/api/auth/me'),
  requestReset: (email: string) =>
    request<{ ok: true; resetPath: string | null }>('/api/auth/password/request', {
      method: 'POST',
      body: json({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>('/api/auth/password/reset', {
      method: 'POST',
      body: json({ token, password }),
    }),

  updateProfile: (input: { displayName?: string; username?: string; bio?: string }) =>
    request<{ user: MeDTO }>('/api/me', { method: 'PATCH', body: json(input) }),
  uploadAvatar: (file: Blob) => {
    const form = new FormData();
    form.append('avatar', file, 'avatar.jpg');
    return upload<{ user: MeDTO }>('/api/me/avatar', form);
  },
  deleteAvatar: () => request<{ user: MeDTO }>('/api/me/avatar', { method: 'DELETE' }),

  feed: (tab: 'foryou' | 'trending' | 'following', page: number) =>
    request<FeedResponse>(`/api/feed?tab=${tab}&page=${page}`),
  post: (id: string) => request<{ post: PostDTO }>(`/api/posts/${id}`),
  createPost: (form: FormData, onProgress?: (percent: number) => void) =>
    upload<{ post: PostDTO }>('/api/posts', form, onProgress),
  updatePost: (id: string, input: { caption?: string; category?: string }) =>
    request<{ post: PostDTO; needsReview: boolean }>(`/api/posts/${id}`, {
      method: 'PATCH',
      body: json(input),
    }),
  deletePost: (id: string) => request<{ ok: true }>(`/api/posts/${id}`, { method: 'DELETE' }),
  userPosts: (username: string, page: number) =>
    request<{ items: PostDTO[]; hasMore: boolean; page: number }>(
      `/api/users/${username}/posts?page=${page}`,
    ),
  toggleLike: (id: string) =>
    request<{ liked: boolean; likeCount: number }>(`/api/posts/${id}/like`, { method: 'POST' }),
  comments: (id: string, page = 1) =>
    request<{ comments: CommentDTO[]; hasMore: boolean; page: number }>(
      `/api/posts/${id}/comments?page=${page}`,
    ),
  addComment: (id: string, body: string) =>
    request<{ comment: CommentDTO }>(`/api/posts/${id}/comments`, {
      method: 'POST',
      body: json({ body }),
    }),
  deleteComment: (id: string) =>
    request<{ ok: true }>(`/api/comments/${id}`, { method: 'DELETE' }),
  event: (id: string, kind: 'view' | 'complete' | 'rewatch' | 'skip') =>
    request<{ ok: true }>(`/api/posts/${id}/events`, { method: 'POST', body: json({ kind }) }),
  notInterested: (id: string, hide: boolean) =>
    request<{ hidden: boolean }>(`/api/posts/${id}/not-interested`, {
      method: hide ? 'POST' : 'DELETE',
    }),

  profile: (username: string) => request<{ user: PublicUser }>(`/api/users/${username}`),
  follow: (username: string, on: boolean) =>
    request<{ following: boolean; followerCount: number }>(`/api/users/${username}/follow`, {
      method: on ? 'POST' : 'DELETE',
    }),
  block: (username: string, on: boolean) =>
    request<{ blocked: boolean }>(`/api/users/${username}/block`, {
      method: on ? 'POST' : 'DELETE',
    }),
  reportUser: (username: string, reason: string, note?: string) =>
    request<{ ok: true }>(`/api/users/${username}/report`, {
      method: 'POST',
      body: json({ reason, note }),
    }),
  reportPost: (id: string, reason: string, note?: string) =>
    request<{ ok: true }>(`/api/posts/${id}/report`, {
      method: 'POST',
      body: json({ reason, note }),
    }),
  reportComment: (id: string, reason: string, note?: string) =>
    request<{ ok: true }>(`/api/comments/${id}/report`, {
      method: 'POST',
      body: json({ reason, note }),
    }),

  search: (q: string) =>
    request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),
  category: (id: string, page: number) =>
    request<{ items: PostDTO[]; hasMore: boolean; page: number }>(
      `/api/category/${encodeURIComponent(id)}?page=${page}`,
    ),
  sounds: (q = '', page = 1) =>
    request<{ sounds: SoundLibraryItem[]; hasMore: boolean; page: number }>(
      `/api/sounds?q=${encodeURIComponent(q)}&page=${page}`,
    ),

  interests: () => request<{ interests: InterestView[] }>('/api/me/interests'),
  resetInterests: () => request<{ ok: true }>('/api/me/interests/reset', { method: 'POST' }),
  hidden: () => request<{ items: PostDTO[] }>('/api/me/hidden'),
  blocked: () => request<{ users: PublicUser[] }>('/api/me/blocked'),
  notifications: (markRead = false) =>
    request<{ notifications: NotificationDTO[] }>(`/api/me/notifications?markRead=${markRead ? 1 : 0}`),

  claimAdmin: (token: string) =>
    request<{ ok: true }>('/api/admin/claim', { method: 'POST', body: json({ token }) }),
  adminCounts: () => request<ModerationCounts>('/api/admin/counts'),
  adminQueue: (status: string, page = 1) =>
    request<{ items: AdminQueueItem[]; hasMore: boolean; page: number }>(
      `/api/admin/queue?status=${status}&page=${page}`,
    ),
  adminPost: (id: string) => request<AdminPostDetail>(`/api/admin/posts/${id}`),
  adminDecide: (id: string, action: 'approve' | 'reject' | 'remove', reason?: string) =>
    request<{ ok: true; status: string }>(`/api/admin/posts/${id}/${action}`, {
      method: 'POST',
      body: json({ reason: reason || '' }),
    }),
  adminReports: (status = 'open') =>
    request<{ reports: AdminReport[] }>(`/api/admin/reports?status=${status}`),
  adminResolveReport: (id: string, action: 'dismiss' | 'action') =>
    request<{ ok: true }>(`/api/admin/reports/${id}/resolve`, {
      method: 'POST',
      body: json({ action }),
    }),
  adminSounds: () =>
    request<{
      sounds: {
        id: string;
        title: string;
        url: string;
        createdAt: number;
        ownerUsername: string;
        useCount: number;
        postCount: number;
        size: number;
        durationMs: number;
      }[];
    }>('/api/admin/sounds'),
  adminUsers: (q = '') =>
    request<{ users: AdminUserRow[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`),
  adminSuspend: (id: string, on: boolean, reason?: string) =>
    request<{ ok: true }>(`/api/admin/users/${id}/suspend`, {
      method: on ? 'POST' : 'DELETE',
      body: on ? json({ reason }) : undefined,
    }),
};
