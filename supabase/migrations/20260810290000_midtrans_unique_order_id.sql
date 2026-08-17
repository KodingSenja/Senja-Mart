-- ============================================
-- SENJA MART - MIDTRANS UNIQUE ORDER ID PER ATTEMPT
-- ============================================
-- Fixes: "transaction_details.order_id has already been taken" on payment
-- retry. Midtrans keeps every order_id it has ever seen, so reusing the
-- order UUID as the Midtrans order_id blocks retries after a transaction
-- expired/cancelled. Each payment attempt now gets its own Midtrans
-- order_id (midtrans_order_id, e.g. "<order-uuid>-<timestamp>") while the
-- orders row stays the same (retry never creates a new order).
--
-- Also extends orders.payment_status so the webhook can record the real
-- Midtrans outcome: pending -> 'pending', expire -> 'expired',
-- cancel/deny -> 'failed' (settlement/capture -> 'paid' as before).

-- ------------------------------------------------------------------
-- 1. midtrans_transactions: store the exact order_id sent to Midtrans
-- ------------------------------------------------------------------
alter table public.midtrans_transactions
  add column if not exists midtrans_order_id text;

-- Legacy rows have NULL midtrans_order_id (their Midtrans order_id was the
-- order UUID itself); the webhook/status routes fall back to that. New
-- attempts always store a unique value, so enforce uniqueness on the
-- non-null subset.
create unique index if not exists midtrans_transactions_midtrans_order_id_key
  on public.midtrans_transactions(midtrans_order_id)
  where midtrans_order_id is not null;

-- ------------------------------------------------------------------
-- 2. orders.payment_status: allow pending / expired / failed
-- ------------------------------------------------------------------
alter table public.orders
  drop constraint if exists orders_payment_status_check,
  add constraint orders_payment_status_check
    check (payment_status in ('unpaid', 'pending', 'paid', 'expired', 'failed', 'refunded'));

-- ------------------------------------------------------------------
-- 3. save_midtrans_transaction: accept the per-attempt Midtrans order id
-- ------------------------------------------------------------------
drop function if exists public.save_midtrans_transaction(uuid, text, text, text, text, numeric);

create or replace function public.save_midtrans_transaction(
  p_order_id uuid,
  p_midtrans_order_id text,
  p_transaction_id text,
  p_snap_token text,
  p_redirect_url text,
  p_status text,
  p_amount numeric
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login_required' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.user_id = auth.uid()
  ) then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  insert into public.midtrans_transactions (
    order_id, midtrans_order_id, transaction_id, snap_token, snap_redirect_url, status, amount
  )
  values (
    p_order_id, p_midtrans_order_id, p_transaction_id, p_snap_token, p_redirect_url, p_status, p_amount
  )
  on conflict (order_id) do update set
    midtrans_order_id = excluded.midtrans_order_id,
    transaction_id = excluded.transaction_id,
    snap_token = coalesce(excluded.snap_token, midtrans_transactions.snap_token),
    snap_redirect_url = coalesce(excluded.snap_redirect_url, midtrans_transactions.snap_redirect_url),
    status = excluded.status,
    amount = excluded.amount;
end;
$$;

revoke all on function public.save_midtrans_transaction(uuid, text, text, text, text, text, numeric) from public;
grant execute on function public.save_midtrans_transaction(uuid, text, text, text, text, text, numeric) to authenticated;

-- Service role (server-side webhook / status sync) may manage the rows.
grant select, insert, update, delete on public.midtrans_transactions to service_role;
