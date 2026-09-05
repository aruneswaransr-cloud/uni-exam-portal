import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigError =
  !url || !anonKey
    ? 'Missing Supabase configuration. Check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.'
    : null;

export const supabase: SupabaseClient = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : (null as unknown as SupabaseClient);
