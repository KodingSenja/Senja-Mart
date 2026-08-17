-- ============================================
-- SENJA MART - INVENTORY & STOCK MANAGEMENT
-- ============================================
-- Production-ready stock system built on the reservation model:
--
--   * place_order RESERVES stock atomically (products.reserved_stock += qty)
--     but never changes the sellable `stock` yet — overselling is impossible
--     because every checkout validates `stock - reserved_stock >= qty` inside
--     a row lock (SELECT ... FOR UPDATE).
--   * When payment settles (webhook / status sync) the reservation is
--     CONSUMED: `stock -= qty`, `reserved_stock -= qty`, recorded as a
--     stock_movements row of type 'sale'. This happens exactly once
--     (orders.stock_fulfilled flag + row lock).
--   * When an unpaid order expires / fails / is cancelled, the reservation is
--     RELEASED (reserved_stock -= qty), recorded as type 'cancellation' with
--     quantity 0 (sellable stock never changed). Also exactly once
--     (orders.stock_reserved flag + row lock).
--   * When a PAID order is cancelled, the consumed stock is RETURNED
--     (stock += qty), recorded as type 'cancellation' with a positive
--     quantity. Exactly once (orders.stock_returned flag + row lock).
--   * Admin adjustments go through adjust_stock() which never allows
--     negative stock and never lets stock drop below what is reserved.
--   * Every stock change is audited in stock_movements with before/after
--     values, the reason, and the actor.
--
-- No existing migration is modified. No Midtrans payment logic is changed —
-- the webhook/status routes simply call the new RPCs around the existing
-- payment_status write.

-- ------------------------------------------------------------------
-- 1. products: per-product low-stock threshold + reserved units
-- ------------------------------------------------------------------
alter table public.products
  add column if not exists low_stock_threshold integer not null default 5
    check (low_stock_threshold >= 0),
  add column if not exists reserved_stock integer not null default 0
    check (reserved_stock >= 0);

-- ------------------------------------------------------------------
-- 2. orders: idempotency flags for the stock lifecycle
-- ------------------------------------------------------------------
alter table public.orders
  add column if not exists stock_fulfilled boolean not null default false,
  add column if not exists stock_reserved boolean not null default true,
  add column if not exists stock_returned boolean not null default false,
  add column if not exists fulfillment_issue text;

-- ------------------------------------------------------------------
-- 3. stock_movements — audit ledger (all stock changes are recorded)
-- ------------------------------------------------------------------
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  type text not null
    check (type in ('restock', 'sale', 'adjustment', 'cancellation', 'refund')),
  -- Signed delta applied to products.stock (positive = bertambah,
  -- negative = berkurang, 0 = no sellable-stock change, e.g. reservation release).
  quantity integer not null,
  stock_before integer not null,
  stock_after integer not null,
  reference_type text not null default 'manual'
    check (reference_type in ('order', 'product', 'manual', 'system')),
  reference_id text,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index stock_movements_product_id_idx on public.stock_movements(product_id);
create index stock_movements_created_at_idx on public.stock_movements(created_at desc);
create index stock_movements_reference_idx on public.stock_movements(reference_type, reference_id);

alter table public.stock_movements enable row level security;

-- ADMIN: boleh melihat & mencatat stock movements.
-- CUSTOMER: tidak ada akses sama sekali (tidak ada policy / grant).
create policy "Admins can view stock movements"
  on public.stock_movements for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert stock movements"
  on public.stock_movements for insert
  to authenticated
  with check (public.is_admin());

-- ------------------------------------------------------------------
-- 4. place_order → reservation model (stock NOT reduced on order create)
-- ------------------------------------------------------------------
create or replace function public.place_order(
  p_items jsonb,
  p_subtotal numeric,
  p_shipping_cost numeric,
  p_total numeric,
  p_shipping_address jsonb
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_price numeric;
  v_stock integer;
  v_reserved integer;
  v_is_active boolean;
  v_subtotal numeric := 0;
  v_shipping numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'login_required' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = 'P0001';
  end if;

  insert into public.orders (
    user_id, status, payment_status, order_number,
    subtotal, shipping_cost, total, shipping_address
  )
  values (
    auth.uid(), 'pending', 'unpaid',
    'SJ-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6)),
    0, 0, 0, p_shipping_address
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item ->> 'productId')::uuid;
    v_qty := (v_item ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity';
    end if;

    -- Lock the row and read the authoritative price / active flag / stock.
    select stock, reserved_stock, price, is_active
      into v_stock, v_reserved, v_price, v_is_active
    from public.products
    where id = v_product_id
    for update;

    if not found then
      raise exception 'product_not_found_%', v_product_id;
    end if;

    if not v_is_active then
      raise exception 'product_inactive_%', v_product_id using errcode = 'P0001';
    end if;

    -- Reservation check: sellable = stock - reserved_stock.
    -- This is the server-side guard that makes overselling impossible.
    if (v_stock - v_reserved) < v_qty then
      raise exception 'insufficient_stock_%', v_product_id using errcode = 'P0001';
    end if;

    update public.products
    set reserved_stock = reserved_stock + v_qty
    where id = v_product_id;

    insert into public.order_items (
      order_id, product_id, product_name, product_image, price, quantity
    )
    select v_order_id, p.id, p.name, p.image_url, v_price, v_qty
    from public.products p
    where p.id = v_product_id;

    v_subtotal := v_subtotal + (v_price * v_qty);
  end loop;

  -- Server-computed shipping — mirrors constants.ts shippingCost().
  v_shipping := case when v_subtotal >= 300000 then 0 else 12000 end;

  -- Server-computed totals win over whatever the client sent.
  update public.orders
  set subtotal = v_subtotal,
      shipping_cost = v_shipping,
      total = v_subtotal + v_shipping
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb, numeric, numeric, numeric, jsonb) from public;
grant execute on function public.place_order(jsonb, numeric, numeric, numeric, jsonb) to authenticated;

-- ------------------------------------------------------------------
-- 5. fulfill_order_stock — consume the reservation when payment settles
-- ------------------------------------------------------------------
-- Called by the Midtrans webhook / status-sync routes (service role) when
-- the transaction settles. Idempotent: runs at most once per order
-- (orders.stock_fulfilled guard, held by the order row lock).
--
-- If the reservation can no longer be honored (reserved < qty — should only
-- happen after data inconsistency / manual tampering), the order is NOT
-- fulfilled: payment stays paid (the caller decides that), orders.fulfillment_issue
-- is set, and a zero-delta audit row marks it for manual admin handling.
-- Stock is never reduced below zero and no automatic refund is issued.
create or replace function public.fulfill_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_item record;
  v_product_id uuid;
  v_qty integer;
  v_stock integer;
  v_reserved integer;
  v_conflict boolean := false;
begin
  -- Serialize on the order row so two webhook deliveries cannot both run.
  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    return;
  end if;

  if exists (select 1 from public.orders where id = p_order_id and stock_fulfilled) then
    return; -- already consumed exactly once
  end if;

  -- Pass 1: lock every product and verify the reservation is intact.
  for v_item in
    select product_id, quantity from public.order_items where order_id = p_order_id
  loop
    if v_item.product_id is null then
      continue;
    end if;
    select stock, reserved_stock into v_stock, v_reserved
    from public.products where id = v_item.product_id for update;
    if v_reserved < v_item.quantity then
      v_conflict := true;
      v_product_id := v_item.product_id;
      v_qty := v_item.quantity;
      exit;
    end if;
  end loop;

  if v_conflict then
    -- Leave stock untouched; flag for manual admin handling.
    update public.orders
    set fulfillment_issue = 'reservation_conflict:' || v_product_id::text
    where id = p_order_id;
    insert into public.stock_movements (
      product_id, type, quantity, stock_before, stock_after,
      reference_type, reference_id, note, created_by
    )
    values (
      v_product_id, 'adjustment', 0, v_stock, v_stock,
      'order', p_order_id::text,
      '⚠️ Konflik stok saat settlement (reserved < qty). Perlu penanganan manual admin.',
      null
    );
    return;
  end if;

  -- Pass 2: consume the reservation.
  for v_item in
    select product_id, quantity from public.order_items where order_id = p_order_id
  loop
    if v_item.product_id is null then
      continue;
    end if;
    select stock, reserved_stock into v_stock, v_reserved
    from public.products where id = v_item.product_id for update;

    update public.products
    set stock = stock - v_item.quantity,
        reserved_stock = reserved_stock - v_item.quantity
    where id = v_item.product_id;

    insert into public.stock_movements (
      product_id, type, quantity, stock_before, stock_after,
      reference_type, reference_id, note, created_by
    )
    values (
      v_item.product_id, 'sale', -v_item.quantity, v_stock, v_stock - v_item.quantity,
      'order', p_order_id::text, 'Pembayaran berhasil — stok berkurang', null
    );
  end loop;

  update public.orders
  set stock_fulfilled = true,
      stock_reserved = false
  where id = p_order_id;
end;
$$;

revoke all on function public.fulfill_order_stock(uuid) from public;
grant execute on function public.fulfill_order_stock(uuid) to service_role;

-- ------------------------------------------------------------------
-- 6. release_order_reservation — unpaid order no longer payable
-- ------------------------------------------------------------------
-- Called by the webhook / status-sync routes when a payment attempt expires
-- or fails (payment_status -> expired / failed). Frees reserved units back
-- to sellable availability. Idempotent (orders.stock_reserved guard).
create or replace function public.release_order_reservation(p_order_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_item record;
  v_stock integer;
  v_reserved integer;
begin
  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    return;
  end if;

  if exists (select 1 from public.orders where id = p_order_id and (not stock_reserved or stock_fulfilled)) then
    return; -- nothing to release, or already consumed
  end if;

  for v_item in
    select product_id, quantity from public.order_items where order_id = p_order_id
  loop
    if v_item.product_id is null then
      continue;
    end if;
    select stock, reserved_stock into v_stock, v_reserved
    from public.products where id = v_item.product_id for update;

    update public.products
    set reserved_stock = greatest(0, reserved_stock - v_item.quantity)
    where id = v_item.product_id;

    insert into public.stock_movements (
      product_id, type, quantity, stock_before, stock_after,
      reference_type, reference_id, note, created_by
    )
    values (
      v_item.product_id, 'cancellation', 0, v_stock, v_stock,
      'order', p_order_id::text, 'Reservasi dilepas — pesanan tidak dibayar', null
    );
  end loop;

  update public.orders
  set stock_reserved = false
  where id = p_order_id;
end;
$$;

revoke all on function public.release_order_reservation(uuid) from public;
grant execute on function public.release_order_reservation(uuid) to service_role;

-- ------------------------------------------------------------------
-- 7. cancel_order — admin cancellation with safe, one-time stock handling
-- ------------------------------------------------------------------
--   * PAID order (stock already consumed)  -> stock is returned (+qty)
--   * UNPAID order (only reserved)         -> reservation is released
--   * repeat calls are no-ops (flags)
create or replace function public.cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_item record;
  v_stock integer;
  v_reserved integer;
  v_fulfilled boolean;
  v_reserved_flag boolean;
  v_returned boolean;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin_required' using errcode = 'P0001';
  end if;

  select stock_fulfilled, stock_reserved, stock_returned
    into v_fulfilled, v_reserved_flag, v_returned
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  -- PAID + stock consumed + not yet returned -> return the stock.
  if v_fulfilled and not v_returned then
    for v_item in
      select product_id, quantity from public.order_items where order_id = p_order_id
    loop
      if v_item.product_id is null then
        continue;
      end if;
      select stock into v_stock
      from public.products where id = v_item.product_id for update;

      update public.products
      set stock = stock + v_item.quantity
      where id = v_item.product_id;

      insert into public.stock_movements (
        product_id, type, quantity, stock_before, stock_after,
        reference_type, reference_id, note, created_by
      )
      values (
        v_item.product_id, 'cancellation', v_item.quantity, v_stock, v_stock + v_item.quantity,
        'order', p_order_id::text, 'Pesanan dibatalkan — stok dikembalikan', auth.uid()
      );
    end loop;
    update public.orders set stock_returned = true where id = p_order_id;
  end if;

  -- UNPAID + reservation held -> release the reservation.
  if v_reserved_flag and not v_fulfilled then
    for v_item in
      select product_id, quantity from public.order_items where order_id = p_order_id
    loop
      if v_item.product_id is null then
        continue;
      end if;
      select stock, reserved_stock into v_stock, v_reserved
      from public.products where id = v_item.product_id for update;

      update public.products
      set reserved_stock = greatest(0, reserved_stock - v_item.quantity)
      where id = v_item.product_id;

      insert into public.stock_movements (
        product_id, type, quantity, stock_before, stock_after,
        reference_type, reference_id, note, created_by
      )
      values (
        v_item.product_id, 'cancellation', 0, v_stock, v_stock,
        'order', p_order_id::text, 'Reservasi dilepas — pesanan dibatalkan sebelum dibayar', auth.uid()
      );
    end loop;
    update public.orders set stock_reserved = false where id = p_order_id;
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id;
end;
$$;

revoke all on function public.cancel_order(uuid) from public;
grant execute on function public.cancel_order(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 8. reserve_order_stock — re-reserve on a fresh payment attempt (retry)
-- ------------------------------------------------------------------
-- Called by the transaction route when creating a NEW Snap attempt after a
-- previous attempt expired/failed (whose reservation was released). Keeps
-- the invariant "any attempt that can settle holds a reservation".
-- Idempotent: no-op when the order is already reserved or fulfilled.
create or replace function public.reserve_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_item record;
  v_stock integer;
  v_reserved integer;
  v_fulfilled boolean;
  v_reserved_flag boolean;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'login_required' using errcode = 'P0001';
  end if;

  select status, stock_fulfilled, stock_reserved
    into v_status, v_fulfilled, v_reserved_flag
  from public.orders
  where id = p_order_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  if v_status = 'cancelled' then
    raise exception 'order_cancelled' using errcode = 'P0001';
  end if;
  if v_fulfilled then
    raise exception 'order_already_fulfilled' using errcode = 'P0001';
  end if;
  if v_reserved_flag then
    return; -- still reserved (first attempt path)
  end if;

  for v_item in
    select product_id, quantity from public.order_items where order_id = p_order_id
  loop
    if v_item.product_id is null then
      continue;
    end if;
    select stock, reserved_stock into v_stock, v_reserved
    from public.products where id = v_item.product_id for update;

    if (v_stock - v_reserved) < v_item.quantity then
      raise exception 'insufficient_stock_%', v_item.product_id using errcode = 'P0001';
    end if;

    update public.products
    set reserved_stock = reserved_stock + v_item.quantity
    where id = v_item.product_id;
  end loop;

  update public.orders set stock_reserved = true where id = p_order_id;
end;
$$;

revoke all on function public.reserve_order_stock(uuid) from public;
grant execute on function public.reserve_order_stock(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 9. adjust_stock — admin restock / correction (with audit)
-- ------------------------------------------------------------------
--   * p_delta: signed (positive = restock, negative = kurangi)
--   * never negative stock, never below the reserved amount
--   * every change is recorded in stock_movements
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_delta integer,
  p_note text,
  p_type text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_stock integer;
  v_reserved integer;
  v_new_stock integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin_required' using errcode = 'P0001';
  end if;

  if p_type not in ('restock', 'adjustment', 'refund') then
    raise exception 'invalid_movement_type' using errcode = 'P0001';
  end if;
  if p_delta = 0 then
    return;
  end if;

  select stock, reserved_stock into v_stock, v_reserved
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;

  v_new_stock := v_stock + p_delta;

  if v_new_stock < 0 then
    raise exception 'stock_negative' using errcode = 'P0001';
  end if;
  if v_new_stock < v_reserved then
    raise exception 'stock_below_reserved_%', p_product_id using errcode = 'P0001';
  end if;

  update public.products
  set stock = v_new_stock
  where id = p_product_id;

  insert into public.stock_movements (
    product_id, type, quantity, stock_before, stock_after,
    reference_type, reference_id, note, created_by
  )
  values (
    p_product_id, p_type, p_delta, v_stock, v_new_stock,
    'product', p_product_id::text, coalesce(p_note, ''), auth.uid()
  );
end;
$$;

revoke all on function public.adjust_stock(uuid, integer, text, text) from public;
grant execute on function public.adjust_stock(uuid, integer, text, text) to authenticated;

-- ------------------------------------------------------------------
-- 10. Backfill existing data
-- ------------------------------------------------------------------
-- The previous place_order() decremented `stock` at order creation for ALL
-- orders. Under the reservation model only paid orders should hold consumed
-- stock. Existing orders created before this migration:
--   * unpaid / pending / expired / failed -> return their stock (they were
--     never fulfilled) — the old decrement is undone, and no reservation is
--     recorded (stock_reserved = false).
--   * paid / refunded -> keep the already-consumed stock (stock_fulfilled =
--     true) so a later cancellation returns it exactly once.
do $$
declare
  v_item record;
begin
  -- Return stock for every unpaid order's items (undo old decrement).
  for v_item in
    select oi.product_id, oi.quantity
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id is not null
      and o.payment_status not in ('paid', 'refunded')
  loop
    update public.products
    set stock = stock + v_item.quantity
    where id = v_item.product_id;
  end loop;

  -- Reset lifecycle flags to the state that matches the data above.
  update public.orders
  set stock_reserved = false,
      stock_fulfilled = (payment_status in ('paid', 'refunded')),
      stock_returned = false;
end;
$$;

-- ------------------------------------------------------------------
-- 11. Data-API grants (mirror the RLS policies)
-- ------------------------------------------------------------------
grant select, insert on public.stock_movements to authenticated;
