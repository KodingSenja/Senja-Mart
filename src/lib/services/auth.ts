'use client';

import type { UserProfile, UserRole } from 'types/user';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

interface ProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
}

function mapProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: '', // filled from auth user
    name: row.full_name ?? null,
    avatar: row.avatar_url ?? null,
    phone: row.phone ?? null,
    role: row.role === 'admin' ? 'admin' : 'customer',
    createdAt: row.created_at,
  };
}

/**
 * Current authenticated user + their `profiles` row.
 * Returns null when signed out or when Supabase isn't configured.
 */
export async function getCurrentUser(): Promise<UserProfile | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const profile: UserProfile = {
    id: data.user.id,
    email: data.user.email ?? '',
    name:
      (data.user.user_metadata?.full_name as string | undefined) ?? null,
    avatar: data.user.user_metadata?.avatar_url as string | undefined ?? null,
    role: 'customer',
  };

  const { data: row, error: rowError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!rowError && row) {
    const mapped = mapProfile(row as ProfileRow);
    mapped.email = profile.email;
    if (!profile.name) mapped.name = null;
    return mapped;
  }
  return profile;
}

export async function signIn(email: string, password: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signUp(
  email: string,
  password: string,
  fullName: string
): Promise<{ needsConfirmation: boolean }> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw new Error(error.message);
  return { needsConfirmation: !data.session };
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  await supabase.auth.signOut();
}

export async function updateProfile(input: {
  full_name?: string;
  phone?: string;
  avatar_url?: string;
}): Promise<UserProfile | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return null;

  const updates: Record<string, string> = {};
  if (input.full_name !== undefined) updates.full_name = input.full_name;
  if (input.phone !== undefined) updates.phone = input.phone;
  if (input.avatar_url !== undefined) updates.avatar_url = input.avatar_url;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.user.id);
    if (error) throw new Error(error.message);
  }
  return getCurrentUser();
}

export { type UserRole };
