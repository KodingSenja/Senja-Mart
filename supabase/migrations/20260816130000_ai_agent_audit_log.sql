-- ============================================
-- SENJA MART - AI AGENT AUDIT LOG
-- ============================================
-- Additive audit trail for AI Agent write/action tools. The AI Agent only
-- performs a write after a server-side confirmation, and every executed
-- write is recorded here (user, action, target, params, result, time).
--
-- Scope: NEW table only. No existing table, policy, RPC, or data is
-- touched. No service_role involvement: rows are inserted through the
-- signed-in admin's own (RLS-enforced) session via the INSERT policy
-- below, and can only be read by admins.
--
-- Idempotent: single migration, applied once.

create table public.ai_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target text,
  detail jsonb,
  result text,
  created_at timestamptz not null default now()
);

create index ai_audit_log_created_at_idx on public.ai_audit_log(created_at desc);
create index ai_audit_log_user_id_idx on public.ai_audit_log(user_id);
create index ai_audit_log_action_idx on public.ai_audit_log(action);

alter table public.ai_audit_log enable row level security;

-- Admin-only: same role check every admin policy in the project uses.
create policy "Admins can view AI audit log"
  on public.ai_audit_log for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert AI audit log"
  on public.ai_audit_log for insert
  to authenticated
  with check (public.is_admin());

-- Mirror the project's "grant mirrors RLS" pattern (M9).
grant select, insert on public.ai_audit_log to authenticated;
