-- ============================================
-- SENJA MART - ORDER FLOW (atomic checkout)
-- ============================================
-- Adds:
--   * orders.order_number (human friendly, e.g. SJ-20260810-AB12CD)
--   * public.place_order(...) — security definer RPC that atomically
--     creates the order + order_items and decrements product stock.
--     Customers can't update products directly (RLS), so stock changes
--     must happen inside this function.

alter table public.orders
  add column if not exists order_number text;

-- Backfill existing rows (should be none yet, but keep it safe).
update public.orders
set order_number = 'SJ-' || to_char(created_at, 'YYYYMMDD') || '-' || upper(substr(md5(id::text), 1, 6))
where order_number is null;

create unique index orders_order_number_key on public.orders(order_number);

-- ------------------------------------------------------------------
-- place_order RPC
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
begin
  if auth.uid() is null then
    raise exception 'login_required' using errcode = 'P0001';
  end if;

  -- Validate money before writing anything.
  if p_subtotal < 0 or p_shipping_cost < 0 or p_total < 0 then
    raise exception 'invalid_amount';
  end if;

  insert into public.orders (
    user_id, status, payment_status, order_number,
    subtotal, shipping_cost, total, shipping_address
  )
  values (
    auth.uid(), 'pending', 'unpaid',
    'SJ-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6)),
    p_subtotal, p_shipping_cost, p_total, p_shipping_address
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item ->> 'productId')::uuid;
    v_qty := (v_item ->> 'quantity')::integer;
    v_price := (v_item ->> 'price')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity';
    end if;

    select stock into v_stock
    from public.products
    where id = v_product_id
    for update;

    if not found then
      raise exception 'product_not_found_%', v_product_id;
    end if;

    if v_stock < v_qty then
      raise exception 'insufficient_stock_%', v_product_id using errcode = 'P0001';
    end if;

    update public.products
    set stock = stock - v_qty
    where id = v_product_id;

    insert into public.order_items (
      order_id, product_id, product_name, product_image, price, quantity
    )
    select v_order_id, p.id, p.name, p.image_url, v_price, v_qty
    from public.products p
    where p.id = v_product_id;
  end loop;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb, numeric, numeric, numeric, jsonb) from public;
grant execute on function public.place_order(jsonb, numeric, numeric, numeric, jsonb) to authenticated;
