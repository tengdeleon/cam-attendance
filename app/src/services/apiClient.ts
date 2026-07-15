// Thin fetch wrapper around the FastAPI backend.
// Reads EXPO_PUBLIC_API_BASE_URL and attaches the Supabase access token.
import { supabase } from './supabaseClient';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL!;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * Turn a non-OK Response into an ApiError with a GUARANTEED string message.
 * Defends against backend error shapes where `detail` (or `detail.detail`) is an
 * object/array — passing that straight to Error() coerces it to "[object Object]".
 * FastAPI business rejections use { detail: { detail: string, code: string } };
 * validation errors use { detail: [...] }; unhandled errors use { detail: string }.
 */
async function toApiError(res: Response): Promise<ApiError> {
  let detail: string = res.statusText;
  let code: string | undefined;
  try {
    const body = await res.json();
    const d = body?.detail;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      code = typeof d.code === 'string' ? d.code : undefined;
      detail = typeof d.detail === 'string' ? d.detail : JSON.stringify(d);
    } else if (typeof d === 'string') {
      detail = d;
    } else if (d !== undefined) {
      detail = JSON.stringify(d); // array (422 validation) or other
    } else {
      detail = JSON.stringify(body);
    }
  } catch {
    /* non-JSON error body — keep statusText */
  }
  return new ApiError(res.status, detail, code);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token ?? ''}`,
    ...(init.headers as Record<string, string>),
  };
  // Let fetch set the multipart boundary itself for FormData bodies.
  if (init.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    throw await toApiError(res);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Same as api() but returns the raw response body as text (e.g. CSV). */
export async function apiText(path: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return res.text();
}
