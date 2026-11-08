export class ApiError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;

  constructor(message: string, status: number, options?: { code?: string; fields?: Record<string, string> }) {
    super(message);
    this.status = status;
    this.code = options?.code;
    this.fields = options?.fields;
  }
}

/**
 * The website is a static build on GitHub Pages and the API is a Cloudflare
 * Worker on another origin, so requests carry a bearer token from local
 * storage. Empty VITE_API_ORIGIN means both live on one origin.
 */
export const API_BASE = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '');

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
      /* private browsing */
    }
  },
};

function withBase(path: string): string {
  if (/^https?:/i.test(path)) return path;
  return `${API_BASE}${path}`;
}

function authHeaders(): Record<string, string> {
  const token = tokenStore.get();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Session endpoints hand back a token; keep it here so pages stay unaware. */
function absorbAuth(path: string, payload: unknown) {
  if (!path.startsWith('/api/auth/')) return;
  const value = payload as { token?: string } | null;
  if (value?.token) tokenStore.set(value.token);
  if (path === '/api/auth/logout') tokenStore.set(null);
}

/**
 * Tells the server where this visit came from, once per page load. Only the
 * referring host, the route and an explicit `utm_source` are sent: never the
 * full URL, so nothing personal rides along in a query string.
 */
export function recordVisit(path: string) {
  const params = new URLSearchParams(window.location.search);
  const body = JSON.stringify({
    ref: document.referrer || '',
    path,
    utm: params.get('utm_source') || params.get('ref') || '',
  });
  try {
    // keepalive lets a visitor who bounces after a second still be counted.
    void fetch(withBase('/api/visits'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* counting a visit must never break the page */
  }
}

async function handle<T>(response: Response, path: string): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const error = payload as { error?: string; code?: string; fields?: Record<string, string> } | null;
    throw new ApiError(error?.error || 'Something went wrong. Try again.', response.status, {
      code: error?.code,
      fields: error?.fields,
    });
  }
  absorbAuth(path, payload);
  return payload as T;
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(withBase(path), {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...init?.headers,
    },
  }).then((response) => handle<T>(response, path));
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Pending media is served only to its owner and the moderator, and a <video>
 * element cannot send an Authorization header. Fetching the bytes first and
 * handing the element an object URL keeps that gate intact.
 */
export async function fetchMediaObjectUrl(url: string): Promise<string> {
  const response = await fetch(withBase(url), { headers: authHeaders() });
  if (!response.ok) {
    let message = 'That video could not be loaded.';
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      /* the body was not JSON */
    }
    throw new ApiError(message, response.status);
  }
  return URL.createObjectURL(await response.blob());
}

export function uploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress: (percent: number) => void,
  onUploaded?: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBase(path));
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.upload.onload = () => onUploaded?.();
    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(xhr.responseText || 'null');
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        absorbAuth(path, payload);
        resolve(payload as T);
        return;
      }
      const error = payload as { error?: string; code?: string; fields?: Record<string, string> } | null;
      reject(
        new ApiError(error?.error || 'The upload did not go through.', xhr.status, {
          code: error?.code,
          fields: error?.fields,
        }),
      );
    };
    xhr.onerror = () =>
      reject(new ApiError('The upload lost its connection. Send it again in a moment.', 0));
    xhr.ontimeout = () => reject(new ApiError('The upload timed out. Try again.', 0));
    xhr.send(formData);
  });
}

/** Uploads a video in small pieces so no single request gets too large. */
export async function uploadVideo(
  file: File,
  poster: Blob | null,
  frames: Blob[],
  meta: { duration: number; width: number; height: number },
  onProgress: (percent: number) => void,
): Promise<string> {
  const start = await api.post<{ uploadId: string; chunkSize: number }>('/api/uploads', {
    mime: file.type || 'video/mp4',
    size: file.size,
    durationMs: Math.round(meta.duration * 1000),
  });

  const chunkSize = start.chunkSize;
  const total = Math.max(1, Math.ceil(file.size / chunkSize));
  for (let index = 0; index < total; index += 1) {
    const slice = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize));
    const form = new FormData();
    form.append('chunk', slice, `chunk-${index}`);

    // A dropped connection on any single chunk used to throw away the whole
    // upload. Re-sending just that slice costs a second and keeps the rest.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await uploadWithProgress(
          `/api/uploads/${start.uploadId}/chunks?index=${index}`,
          form,
          (percent) => {
            onProgress(Math.round(((index + percent / 100) / total) * 100));
          },
        );
        break;
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 0;
        // 0 is a dropped connection, 5xx is the edge having a bad moment. A 4xx
        // means the slice itself was refused, so trying again only wastes time.
        const retriable = status === 0 || status >= 500;
        if (!retriable || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  if (poster || frames.length) {
    const form = new FormData();
    if (poster) form.append('poster', poster, 'poster.jpg');
    // Stills for the safety screen travel with the poster, so sampling the clip
    // costs the uploader one request instead of three.
    frames.forEach((frame, index) => {
      form.append(`frame${index}`, frame, `frame-${index}.jpg`);
    });
    form.append('durationMs', String(Math.round(meta.duration * 1000)));
    form.append('width', String(meta.width));
    form.append('height', String(meta.height));
    await uploadWithProgress(`/api/uploads/${start.uploadId}/poster`, form, () => {});
  }

  onProgress(100);
  return start.uploadId;
}
