-- ============================================
-- SENJA MART - COMPLETE E-COMMERCE SCHEMA
-- ============================================
-- Extends the initial schema (profiles, categories, products,
-- product_images) with the tables and policies an e-commerce app needs:
--   * products: unit, featured, badge, rating, review_count
--   * orders / order_items (price snapshot at purchase time)
--   * cart_items (per authenticated user)
--   * reviews (per user per product)
--   * updated_at triggers, signup -> profile trigger (first user = admin)
--   * full RLS: customers see/manage their own data; admins manage catalog
--   * Supabase Storage bucket "product-images" (public read, admin write)

-- ------------------------------------------------------------------
-- 0. updated_at helper
-- ------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- 1. products: e-commerce columns used by the storefront UI
-- ------------------------------------------------------------------
alter table public.products
  add column if not exists unit text not null default '',
  add column if not exists featured boolean not null default false,
  add column if not exists badge text
    check (badge is null or badge in ('sale', 'hot', 'new')),
  add column if not exists rating numeric(2, 1) not null default 0
    check (rating >= 0 and rating <= 5),
  add column if not exists review_count integer not null default 0
    check (review_count >= 0);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- 2. orders (customer checkout)
-- ------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded')),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  shipping_cost numeric(12, 2) not null default 0 check (shipping_cost >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  shipping_address jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_user_id_idx on public.orders(user_id);
create index orders_created_at_idx on public.orders(created_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- 3. order_items (snapshot: survives product edits / deletion)
-- ------------------------------------------------------------------
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  product_image text,
  price numeric(12, 2) not null check (price >= 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items(order_id);

-- ------------------------------------------------------------------
-- 4. cart_items (one row per user + product)
-- ------------------------------------------------------------------
create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index cart_items_user_id_idx on public.cart_items(user_id);

create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- 5. reviews (per user per product; drives product rating)
-- ------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  review text,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index reviews_product_id_idx on public.reviews(product_id);
create index reviews_user_id_idx on public.reviews(user_id);

-- Recompute product rating + review_count whenever reviews change.
create or replace function public.recompute_product_rating()
returns trigger
language plpgsql
as $$
begin
  update public.products
  set rating = coalesce(
        (select round(avg(r.rating)::numeric, 1)
           from public.reviews r where r.product_id = coalesce(new.product_id, old.product_id)),
        0),
      review_count = (
        select count(*) from public.reviews r
        where r.product_id = coalesce(new.product_id, old.product_id))
  where id = coalesce(new.product_id, old.product_id);
  return null;
end;
$$;

create trigger reviews_recompute_product_rating
  after insert or update or delete on public.reviews
  for each row execute function public.recompute_product_rating();

-- ------------------------------------------------------------------
-- 6. signup -> profile trigger (first registered user becomes admin)
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1),
      'Pengguna'
    ),
    case when not exists (select 1 from public.profiles) then 'admin' else 'customer' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------
-- 7. admin helper (security definer, safe for RLS policies)
-- ------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ------------------------------------------------------------------
-- 8. RLS on new tables
-- ------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.cart_items enable row level security;
alter table public.reviews enable row level security;

-- orders: customers see/create their own; admins manage all
create policy "Customers can view own orders"
  on public.orders for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Customers can create own orders"
  on public.orders for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Admins can view all orders"
  on public.orders for select
  to authenticated
  using (public.is_admin());

create policy "Admins can update orders"
  on public.orders for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- order_items: visible through the owning order
create policy "Customers can view own order items"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );

create policy "Customers can create order items for own orders"
  on public.order_items for insert
  to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );

create policy "Admins can view order items"
  on public.order_items for select
  to authenticated
  using (public.is_admin());

-- cart_items: strictly per-user
create policy "Users can view own cart"
  on public.cart_items for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own cart"
  on public.cart_items for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own cart"
  on public.cart_items for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own cart"
  on public.cart_items for delete
  to authenticated
  using (auth.uid() = user_id);

-- reviews: anyone can read; authors manage their own
create policy "Anyone can view reviews"
  on public.reviews for select
  using (true);

create policy "Users can insert own reviews"
  on public.reviews for insert
  to authenticated
  with check (auth.uid() = user_id and rating between 1 and 5);

create policy "Users can update own reviews"
  on public.reviews for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and rating between 1 and 5);

create policy "Users can delete own reviews"
  on public.reviews for delete
  to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- 9. Admin policies on existing tables (catalog management)
-- ------------------------------------------------------------------
create policy "Admins can insert products"
  on public.products for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update products"
  on public.products for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete products"
  on public.products for delete
  to authenticated
  using (public.is_admin());

create policy "Admins can insert categories"
  on public.categories for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update categories"
  on public.categories for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete categories"
  on public.categories for delete
  to authenticated
  using (public.is_admin());

create policy "Admins can insert product images"
  on public.product_images for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update product images"
  on public.product_images for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete product images"
  on public.product_images for delete
  to authenticated
  using (public.is_admin());

create policy "Admins can view all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------------
-- 10. Storage bucket for product images
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "Public can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "Admins can upload product images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

create policy "Admins can update product images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

create policy "Admins can delete product images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
