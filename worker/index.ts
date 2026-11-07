import {
  Env,
  HttpError,
  corsHeaders,
  json,
  preflight,
  str,
  text,
} from './lib';
import { currentUser } from './session';
import {
  categories,
  commentReportReasons,
  guidelines,
  limits,
  moderation,
  postReportReasons,
  rejectionReasons,
} from './config';
import {
  deleteAvatar,
  login,
  logout,
  me,
  publicProfile,
  register,
  requestReset,
  resetPassword,
  updateProfile,
  uploadAvatar,
} from './routes/auth';
import {
  addComment,
  categoryPosts,
  createPost,
  deleteComment,
  deletePost,
  feed,
  listComments,
  myPosts,
  postDetail,
  postEvent,
  reportComment,
  reportPost,
  toggleCommentLike,
  setNotInterested,
  soundLibrary,
  toggleLike,
  updatePost,
} from './routes/posts';
import {
  block,
  blockedUsers,
  follow,
  followList,
  hiddenPosts,
  interests,
  markNotificationsRead,
  notifications,
  reportUser,
  resetInterests,
  search,
} from './routes/social';
import * as admin from './routes/admin';
import { createTicket, resolveTicket, tickets } from './routes/support';
import { avatar, photo, poster, sound, video } from './routes/media';
import { putChunk, putPoster, startUpload } from './routes/uploads';
import { changePassword, usernameAvailable } from './routes/auth';

const CONFIG_CACHE = 'public, max-age=300';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return preflight(req, env);

    const origin = url.origin;
    let response: Response;

    try {
      response = await route(req, env, url, origin);
    } catch (error) {
      if (error instanceof HttpError) {
        response = json({ error: error.message }, error.status);
      } else {
        console.error('unhandled', error);
        response = json(
          { error: 'Something went wrong on our side. Try again in a moment.' },
          500,
        );
      }
    }

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders(req, env))) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};

async function route(req: Request, env: Env, url: URL, origin: string): Promise<Response> {
  const path = url.pathname;
  const parts = path.split('/').filter(Boolean);
  const method = req.method;

  if (path === '/api/health') return json({ ok: true, service: 'goatmedia-api' });

  if (path === '/api/config') {
    const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{
      n: number;
    }>();
    return json(
      {
        limits: {
          maxUploadMb: limits.maxVideoMb,
          maxVideoMb: limits.maxVideoMb,
          maxDurationSeconds: limits.maxDurationSeconds,
          minDurationSeconds: limits.minDurationSeconds,
          maxPhotos: limits.maxPhotos,
          maxPhotoMb: limits.maxPhotoMb,
          maxAudioMb: limits.maxAudioMb,
          maxAvatarMb: limits.maxAvatarMb,
          maxCaptionLength: limits.maxCaptionLength,
          maxBioLength: limits.maxBioLength,
          maxCommentsPerMinute: limits.maxCommentsPerMinute,
          minAge: limits.minAge,
        },
        categories,
        moderation,
        resetLinkExposed: true,
        reportReasons: {
          video: postReportReasons,
          post: postReportReasons,
          comment: commentReportReasons,
        },
        rejectReasons: rejectionReasons,
        guidelines,
        adminClaimable: (admins?.n ?? 0) === 0,
        passwordReset: 'link-on-screen',
      },
      200,
      { 'cache-control': CONFIG_CACHE },
    );
  }

  // ---- media -------------------------------------------------------------
  if (parts[0] === 'media' && (method === 'GET' || method === 'HEAD')) {
    if (parts[1] === 'photos' && parts[2]) return photo(req, env, parts[2]);
    if (parts[1] === 'sounds' && parts[2]) return sound(req, env, parts[2]);
    if (parts[1] === 'avatars' && parts[2]) return avatar(req, env, parts[2]);
    if (parts[1] === 'videos' && parts[2]) return video(req, env, parts[2]);
    if (parts[1] === 'posters' && parts[2]) return poster(req, env, parts[2]);
    return json({ error: 'Not found.' }, 404);
  }

  // ---- chunked video uploads ---------------------------------------------
  if (parts[0] === 'api' && parts[1] === 'uploads') {
    if (parts.length === 2 && method === 'POST') return startUpload(req, env);
    if (parts[2] && parts[3] === 'chunks' && method === 'POST') {
      return putChunk(req, env, url, parts[2]);
    }
    if (parts[2] && parts[3] === 'poster' && method === 'POST') return putPoster(req, env, parts[2]);
  }

  if (parts[0] !== 'api') return text('GoatMedia API. The app lives on GitHub Pages.', 404);

  const [, root, second, third, fourth] = parts;

  // ---- auth --------------------------------------------------------------
  if (root === 'auth') {
    if (second === 'register' && method === 'POST') return register(req, env, origin);
    if (second === 'login' && method === 'POST') return login(req, env, origin);
    if (second === 'logout' && method === 'POST') return logout(req, env);
    if (second === 'me' && method === 'GET') return me(req, env, origin);
    if (second === 'password' && third === 'request' && method === 'POST') {
      return requestReset(req, env, origin);
    }
    if (second === 'password' && third === 'reset' && method === 'POST') return resetPassword(req, env);
    if (second === 'password' && third === 'change' && method === 'POST') return changePassword(req, env);
    return json({ error: 'Not found.' }, 404);
  }

  if (root === 'usernames' && second && third === 'available' && method === 'GET') {
    return usernameAvailable(env, second);
  }

  // ---- me ----------------------------------------------------------------
  if (root === 'me') {
    if (!second && method === 'PATCH') return updateProfile(req, env, origin);
    if (!second && method === 'GET') return me(req, env, origin);
    if (second === 'avatar' && method === 'POST') return uploadAvatar(req, env, origin);
    if (second === 'avatar' && method === 'DELETE') return deleteAvatar(req, env, origin);
    if (second === 'interests' && !third && method === 'GET') return interests(req, env);
    if (second === 'interests' && third === 'reset' && method === 'POST') return resetInterests(req, env);
    if (second === 'reset-interests' && method === 'POST') return resetInterests(req, env);
    if (second === 'hidden' && !third && method === 'GET') return hiddenPosts(req, env, origin);
    if (second === 'hidden' && third && method === 'DELETE') return setNotInterested(req, env, third, false);
    if (second === 'blocked' && method === 'GET') return blockedUsers(req, env, origin);
    if (second === 'notifications' && !third && method === 'GET') return notifications(req, env, url);
    if (second === 'notifications' && third === 'read' && method === 'POST') {
      return markNotificationsRead(req, env);
    }
    return json({ error: 'Not found.' }, 404);
  }

  // ---- notifications (original route names) -------------------------------
  if (root === 'notifications') {
    if (!second && method === 'GET') return notifications(req, env, url);
    if (second === 'read' && method === 'POST') return markNotificationsRead(req, env);
    return json({ error: 'Not found.' }, 404);
  }

  // ---- feed --------------------------------------------------------------
  if (root === 'feed' && method === 'GET') return feed(req, env, origin, url);
  if (root === 'category' && second && method === 'GET') return categoryPosts(req, env, origin, url, second);
  if (root === 'search' && method === 'GET') return search(req, env, origin, url);
  if (root === 'sounds' && method === 'GET') return soundLibrary(req, env, url);

  // ---- contact ------------------------------------------------------------
  if (root === 'contact' && method === 'POST') return createTicket(req, env);

  // ---- posts (and the original /api/videos names) -------------------------
  if (root === 'posts' || root === 'videos') {
    if (!second && method === 'POST') return createPost(req, env, origin);
    if (second && parts.length === 3) {
      if (method === 'GET') return postDetail(req, env, origin, second);
      if (method === 'PATCH') return updatePost(req, env, origin, second);
      if (method === 'DELETE') return deletePost(req, env, second);
    }
    if (second && third) {
      if (third === 'like' && method === 'POST') return toggleLike(req, env, second);
      if (third === 'comments' && method === 'GET') return listComments(req, env, url, second);
      if (third === 'comments' && method === 'POST') return addComment(req, env, second);
      if (third === 'events' && method === 'POST') return postEvent(req, env, second);
      if (third === 'report' && method === 'POST') return reportPost(req, env, second);
      if (third === 'not-interested' && method === 'POST') return setNotInterested(req, env, second, true);
      if (third === 'not-interested' && method === 'DELETE') {
        return setNotInterested(req, env, second, false);
      }
    }
    return json({ error: 'Not found.' }, 404);
  }

  if (root === 'comments' && second) {
    if (method === 'DELETE' && parts.length === 3) return deleteComment(req, env, second);
    if (third === 'like' && method === 'POST') return toggleCommentLike(req, env, second, true);
    if (third === 'like' && method === 'DELETE') return toggleCommentLike(req, env, second, false);
    if (third === 'report' && method === 'POST') return reportComment(req, env, second);
    return json({ error: 'Not found.' }, 404);
  }

  // ---- users -------------------------------------------------------------
  if (root === 'users' && second) {
    if (parts.length === 3 && method === 'GET') {
      const viewer = await currentUser(req, env);
      return publicProfile(env, origin, second, viewer?.id ?? null);
    }
    if (third === 'posts' && method === 'GET') return myPosts(req, env, origin, url, second);
    if (third === 'videos' && method === 'GET') return myPosts(req, env, origin, url, second);
    if (third === 'follow' && method === 'POST') return follow(req, env, second, true);
    if (third === 'follow' && method === 'DELETE') return follow(req, env, second, false);
    if (third === 'followers' && method === 'GET') return followList(req, env, origin, second, 'followers', url);
    if (third === 'following' && method === 'GET') return followList(req, env, origin, second, 'following', url);
    if (third === 'block' && method === 'POST') return block(req, env, second, true);
    if (third === 'block' && method === 'DELETE') return block(req, env, second, false);
    if (third === 'report' && method === 'POST') return reportUser(req, env, second);
    return json({ error: 'Not found.' }, 404);
  }

  // ---- admin -------------------------------------------------------------
  if (root === 'admin') {
    if (second === 'claim' && method === 'POST') return admin.claimAdmin(req, env);
    if (second === 'counts' && method === 'GET') return admin.counts(req, env);
    if (second === 'queue' && method === 'GET') return admin.queue(req, env, origin, url);
    if (second === 'reports' && !third && method === 'GET') return admin.reports(req, env, url);
    if (second === 'reports' && third && fourth === 'resolve' && method === 'POST') {
      return admin.resolveReport(req, env, third);
    }
    if (second === 'users' && !third && method === 'GET') return admin.users(req, env, url);
    if (second === 'users' && third && fourth === 'suspend') {
      if (method === 'POST') return admin.suspendUser(req, env, third, true);
      if (method === 'DELETE') return admin.suspendUser(req, env, third, false);
    }
    if (second === 'users' && third && fourth === 'unsuspend' && method === 'POST') {
      return admin.suspendUser(req, env, third, false);
    }
    if (second === 'users' && third && fourth === 'remove' && method === 'POST') {
      return admin.removeUser(req, env, third);
    }
    if (second === 'users' && third && fourth === 'restore' && method === 'POST') {
      return admin.restoreUser(req, env, third);
    }
    if (second === 'users' && third && fourth === 'moderator') {
      if (method === 'POST') return admin.setModerator(req, env, third, true);
      if (method === 'DELETE') return admin.setModerator(req, env, third, false);
    }
    if (second === 'tickets' && !third && method === 'GET') return tickets(req, env, url);
    if (second === 'tickets' && third && fourth === 'resolve' && method === 'POST') {
      return resolveTicket(req, env, third);
    }
    if (second === 'sounds' && method === 'GET') return admin.adminSounds(req, env, url);
    if ((second === 'posts' || second === 'videos') && !third && method === 'GET') {
      return admin.queue(req, env, origin, url);
    }
    if ((second === 'posts' || second === 'videos') && third) {
      if (!fourth && method === 'GET') return admin.detail(req, env, origin, third);
      if (fourth === 'approve' && method === 'POST') return admin.decide(req, env, third, 'approve');
      if (fourth === 'reject' && method === 'POST') return admin.decide(req, env, third, 'reject');
      if (fourth === 'remove' && method === 'POST') return admin.decide(req, env, third, 'remove');
    }
    return json({ error: 'Not found.' }, 404);
  }

  void str;
  return json({ error: 'Not found.' }, 404);
}
