-- ============================================
-- SENJA MART - PHASE 1 SECURITY & PERMISSION FIXES
-- ============================================
-- Applies audit findings C1, H1, M3, M9 only.
--   C1: block self role-escalation on profiles.role
--   H1: admins can SELECT all products & categories (incl. inactive)
--   M3: place_order computes shipping cost server-side (never trusts client)
--   M9: explicit GRANTs matching the RLS policies (PostgREST data API access)
-- No old migration is modified. No UI / frontend change.

-- ------------------------------------------------------------------
-- 1. C1 — prevent privilege escalation on profiles.role
-- ------------------------------------------------------------------
-- Problem: the "Users can update own profile" policy allows updating any
-- column of one's own row (including `role`), so a customer could run
-- `update profiles set role='admin'` and gain admin privileges.
--
-- Fix: BEFORE UPDATE trigger. Non-admin users cannot change `role`.
--   * role unchanged                 -> allowed (normal profile edits)
--   * role changed by an admin       -> allowed (is_admin(), security definer)
--   * role changed by service role   -> allowed (auth.uid() is null, trusted
--     server context — the client app never uses this key)
--   * role changed by a customer     -> rejected
--
-- RLS-recursion safety: the trigger is SECURITY DEFINER (owner = postgres),
-- so its internal `is_admin()` read of `profiles` bypasses RLS policies and
-- cannot re-enter this trigger / policies. This mirrors the already-working
-- pattern of `is_admin()` inside the "Admins can view all profiles" policy.

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Only enforce when the role column actually changes.
  if new.role is distinct from old.role then
    -- Trusted server context (service_role / DB owner) is allowed to manage roles.
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'only_admins_can_change_role' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ------------------------------------------------------------------
-- 2. H1 — admins can SELECT all products & categories
-- ------------------------------------------------------------------
-- Existing policies only expose active rows to everyone. These new
-- policies are additive (RLS policies are OR'd), so:
--   * customers / anon still only see active rows (existing policy)
--   * admins additionally see inactive rows (includeInactive: true in admin UI)

drop policy if exists "Admins can view all products" on public.products;
create policy "Admins can view all products"
  on public.products for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can view all categories" on public.categories;
create policy "Admins can view all categories"
  on public.categories for select
  to authenticated
  using (public.is_admin());

-- product_images: the existing "Anyone can view product images" policy only
-- exposes rows of ACTIVE products. Without this additive policy, an admin
-- editing an inactive product would load an empty gallery (H1 end-to-end).
drop policy if exists "Admins can view all product images" on public.product_images;
create policy "Admins can view all product images"
  on public.product_images for select
  to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------------
-- 3. M3 — shipping cost is computed server-side in place_order
-- ------------------------------------------------------------------
-- The client previously sent p_shipping_cost / p_total and the function
-- used them, so a caller could set shipping to 0. Now shipping is derived
-- from the server-computed subtotal using the same rule as the app's
-- shippingCost() in src/lib/utils/constants.ts:
--   FREE_SHIPPING_THRESHOLD = 300000  (subtotal >= 300000  -> free)
--   SHIPPING_COST           = 12000   (otherwise            -> flat 12000)
-- p_shipping_cost / p_total are accepted for signature compatibility but
-- ignored. Atomicity and the order_items price snapshot are unchanged.

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
-- 4. M9 — explicit GRANTs for the Data API (PostgREST)
-- ------------------------------------------------------------------
-- Supabase exposes tables to anon/authenticated only when those roles hold
-- table privileges. These GRANTs mirror exactly the RLS policies in the
-- schema (nothing extra is granted):
--   * anon          : SELECT on public catalog (products, categories,
--                     product_images, reviews) + execute get_product_reviews
--   * authenticated : SELECT + the DML each policy allows, per table
--   * profiles      : SELECT/UPDATE only (insert happens via the signup
--                     trigger; no delete policy exists)

grant select on public.products, public.categories, public.product_images, public.reviews
  to anon, authenticated;

grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.product_images to authenticated;
grant select, insert, update, delete on public.cart_items to authenticated;
grant select, insert, update, delete on public.reviews to authenticated;
grant select, insert, update on public.orders to authenticated;
grant select, insert on public.order_items to authenticated;
grant select, update on public.profiles to authenticated;

-- Functions used by RLS / RPC (execute only where the policies need it).
grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_product_reviews(uuid) to anon, authenticated;
