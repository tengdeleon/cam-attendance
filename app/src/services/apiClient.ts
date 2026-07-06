// Thin fetch wrapper around the FastAPI backend.
// Reads EXPO_PUBLIC_API_BASE_URL and attaches the Supabase access token.
//
// export async function api(path: string, init: RequestInit = {}, token?: string) {
//   const base = process.env.EXPO_PUBLIC_API_BASE_URL!;
//   const res = await fetch(base + path, {
//     ...init,
//     headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
//   });
//   if (!res.ok) throw new Error(await res.text());
//   return res.json();
// }
// TODO: implement.