/**
 * Audit logging for AI Agent write actions — SERVER-ONLY.
 *
 * Every executed write is recorded in `ai_audit_log` through the signed-in
 * admin's OWN server-side session (the INSERT policy is admin-only, RLS is
 * the enforcement layer — no service role). Audit failures are non-fatal:
 * the action already happened, and we never leak the error into the reply.
 */

import type { AgentContext } from './types';

export interface AuditEntry {
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  result: string;
}

export async function writeAudit(
  ctx: AgentContext,
  entry: AuditEntry
): Promise<void> {
  try {
    const { error } = await ctx.supabase.from('ai_audit_log').insert({
      user_id: ctx.userId,
      action: entry.action,
      target: entry.target,
      detail: entry.detail,
      result: entry.result,
    });
    if (error) {
      console.error(`[ai:audit] insert gagal: ${error.message}`);
    }
  } catch (err) {
    console.error(`[ai:audit] error: ${err instanceof Error ? err.message : err}`);
  }
}
