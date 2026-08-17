-- ============================================
-- SENJA MART - MIDTRANS PAYMENT TRACKING
-- ============================================
-- Minimal persistence for Midtrans Snap transactions so that:
--   * a checkout refresh never creates duplicate Midtrans transactions
--     (idempotency: one snap_token per order while still active)
--   * the payment webhook / status check can verify the transaction's
--     amount before touching orders.payment_status
--
-- Existing flow is untouched:
--   * orders / order_items schema, RLS and place_order() unchanged
--   * payment_status reuses the existing ('unpaid','paid','refunded') column
--   * the client never writes this table directly — writes go through the
--     security-definer save_midtrans_transaction() RPC (owner only) or the
--     server-side service-role client (Midtrans webhook / status sync,
--     which has no user session)

create table public.midtrans_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  transaction_id text,
  snap_token text,
  snap_redirect_url text,
  -- Raw Midtrans transaction_status (pending / settlement / capture /
  -- expire / cancel / deny ...) — granular state for the UI.
  status text not null default 'pending',
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active transaction per order (idempotency for checkout refreshes).
create unique index midtrans_transactions_order_id_key
  on public.midtrans_transactions(order_id);

create index midtrans_transactions_status_idx
  on public.midtrans_transactions(status);

create trigger midtrans_transactions_set_updated_at
  before update on public.midtrans_transactions
  for each row execute function public.set_updated_at();

alter table public.midtrans_transactions enable row level security;

-- Customers may read their own payment rows (used by the idempotency check
-- in the server route: reuse an active snap_token instead of creating a
-- new Midtrans transaction).
create policy "Customers can view own payment transactions"
  on public.midtrans_transactions for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = midtrans_transactions.order_id and o.user_id = auth.uid()
    )
  );

-- No direct insert/update/delete for clients. All writes happen through
-- save_midtrans_transaction() (owner, security definer) or the server-side
-- service role (Midtrans webhook / status sync).

-- ------------------------------------------------------------------
-- Save / refresh the Snap transaction for an order.
-- Security definer: verifies the caller owns the order, then upserts by
-- order_id. Also used to refresh the token after a payment expires.
-- ------------------------------------------------------------------
create or replace function public.save_midtrans_transaction(
  p_order_id uuid,
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
    order_id, transaction_id, snap_token, snap_redirect_url, status, amount
  )
  values (
    p_order_id, p_transaction_id, p_snap_token, p_redirect_url, p_status, p_amount
  )
  on conflict (order_id) do update set
    transaction_id = excluded.transaction_id,
    snap_token = coalesce(excluded.snap_token, midtrans_transactions.snap_token),
    snap_redirect_url = coalesce(excluded.snap_redirect_url, midtrans_transactions.snap_redirect_url),
    status = excluded.status,
    amount = excluded.amount;
end;
$$;

revoke all on function public.save_midtrans_transaction(uuid, text, text, text, text, numeric) from public;
grant execute on function public.save_midtrans_transaction(uuid, text, text, text, text, numeric) to authenticated;

-- Service role (server-side webhook / status sync) may manage the rows.
grant select, insert, update, delete on public.midtrans_transactions to service_role;
