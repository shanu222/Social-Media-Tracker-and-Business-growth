const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/api';
const TOKEN_KEY = 'gd_token';

let token: string | null = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  token = null;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — keep in memory only */
  }
}
export const hasToken = () => Boolean(token);

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and the backend URL.', 0);
  }
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null);
    onUnauthorized?.();
  }
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const data = ct.includes('json') ? await res.json().catch(() => ({})) : {};
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  }
  if (ct.includes('json')) return res.json();
  return (await res.blob()) as unknown as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, form: FormData) => request<T>('POST', p, form, true),
};

/** Downloads an authenticated file (PDF/CSV) without exposing the token in a URL. */
export async function download(path: string, filename: string) {
  const blob = await request<Blob>('GET', path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
