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

async function handle<T>(response: Response): Promise<T> {
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
  return payload as T;
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  }).then(handle<T>);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export function uploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress: (percent: number) => void,
  onUploaded?: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
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
    xhr.onerror = () => reject(new ApiError('The upload lost its connection. Try again.', 0));
    xhr.ontimeout = () => reject(new ApiError('The upload timed out. Try again.', 0));
    xhr.send(formData);
  });
}
