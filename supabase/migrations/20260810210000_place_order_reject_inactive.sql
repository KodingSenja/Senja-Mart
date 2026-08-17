-- ============================================
-- SENJA MART - REJECT CHECKOUT OF INACTIVE PRODUCTS
-- ============================================
-- Production hardening (final audit finding, LOW severity):
--   place_order() allowed a customer to check out a product that had been
--   deactivated (is_active = false) AFTER it was added to their cart.
--   A product's status could change between add-to-cart and checkout, so the
--   checkout must re-validate that every product is still active.
--
-- Behavior change (only):
--   * each product in p_items must have is_active = true at checkout time
--   * otherwise the whole transaction aborts with
--     product_inactive_<product_id> (errcode P0001, same pattern as
--     insufficient_stock_<product_id>)
--   * on abort: order is not created, stock is not decremented, nothing is
--     committed (single transaction -> automatic rollback)
--
-- Unchanged: signature, server-side price snapshot, stock row locking
-- (SELECT ... FOR UPDATE), server-side shipping rule, order visibility,
-- RLS policies, table structure. No frontend / API change.
--
-- The previous function body (migration 20260810120000, M3) is recreated
-- verbatim with the single added is_active check.

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

    -- Lock the row and read the authoritative price + active flag from the DB.
    select stock, price, is_active into v_stock, v_price, v_is_active
    from public.products
    where id = v_product_id
    for update;

    if not found then
      raise exception 'product_not_found_%', v_product_id;
    end if;

    -- HARDENING: deactivated products can no longer be purchased, even if
    -- they were added to the cart while still active.
    if not v_is_active then
      raise exception 'product_inactive_%', v_product_id using errcode = 'P0001';
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
