// Thin fetch wrapper around the FastAPI backend.
// Reads EXPO_PUBLIC_API_BASE_URL and attaches the Supabase access token.
import { supabase } from './supabaseClient';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL!;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
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
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
