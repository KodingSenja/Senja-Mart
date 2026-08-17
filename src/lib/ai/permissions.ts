/**
 * Permission guard — SERVER-ONLY.
 *
 * Every AI Agent request is re-checked against the signed-in user's session
 * via the `is_admin()` RPC (security definer, RLS-backed). This is the same
 * role check every admin policy in the project uses. Customers and
 * unauthenticated callers are rejected before any tool runs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export async function isAdminUser(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return data === true;
}
