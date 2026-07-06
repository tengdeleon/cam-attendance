// Supabase client used ONLY for auth (sign in/out, refresh token).
// All data goes through the FastAPI backend (see apiClient.ts). No direct DB calls.
// import { createClient } from "@supabase/supabase-js";
// export const supabase = createClient(
//   process.env.EXPO_PUBLIC_SUPABASE_URL!,
//   process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
// );
// TODO: implement.