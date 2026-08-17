'use client';

import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** true when the Supabase env vars are configured */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** Singleton browser client. Null (with seeded fallback) until env is set. */
export const supabase =
  isSupabaseConfigured && supabaseUrl && supabaseAnonKey
    ? createBrowserClient(supabaseUrl, supabaseAnonKey)
    : null;
