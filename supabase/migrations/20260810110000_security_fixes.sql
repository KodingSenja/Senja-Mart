-- ============================================
-- SENJA MART - SECURITY & INTEGRITY FIXES
-- ============================================
-- 1. place_order: reads price from the DB (never trusts the client),
--    rejects empty carts, and recomputes subtotal/total server-side.
-- 2. get_product_reviews: security-definer RPC that exposes review rows
--    with the author's full_name WITHOUT widening profiles RLS.

-- ------------------------------------------------------------------
-- 1. Hardened place_order
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
  v_subtotal numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'login_required' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = 'P0001';
  end if;

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
    0, p_shipping_cost, 0, p_shipping_address
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item ->> 'productId')::uuid;
    v_qty := (v_item ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity';
    end if;

    -- Lock the row and read the authoritative price from the DB.
    select stock, price into v_stock, v_price
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

    v_subtotal := v_subtotal + (v_price * v_qty);
  end loop;

  -- Server-computed totals win over whatever the client sent.
  update public.orders
  set subtotal = v_subtotal,
      total = v_subtotal + p_shipping_cost
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb, numeric, numeric, numeric, jsonb) from public;
grant execute on function public.place_order(jsonb, numeric, numeric, numeric, jsonb) to authenticated;

-- ------------------------------------------------------------------
-- 2. get_product_reviews — public review list with author names
-- ------------------------------------------------------------------
create or replace function public.get_product_reviews(p_product_id uuid)
returns table (
  id uuid,
  user_id uuid,
  rating integer,
  review text,
  created_at timestamptz,
  author_name text
)
language sql
stable
security definer set search_path = public
as $$
  select r.id, r.user_id, r.rating, r.review, r.created_at, p.full_name
  from public.reviews r
  left join public.profiles p on p.id = r.user_id
  where r.product_id = p_product_id
  order by r.created_at desc;
$$;

revoke all on function public.get_product_reviews(uuid) from public;
grant execute on function public.get_product_reviews(uuid) to anon, authenticated;
