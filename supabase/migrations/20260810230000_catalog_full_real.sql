-- ============================================
-- SENJA MART - CATALOG FULL REAL (categories / popular / daily best seller)
-- ============================================
-- Makes the storefront categories & products sections fully database-driven:
--   * categories.sort_order  -> homepage order (admin can sort)
--   * products.is_popular    -> "Produk Populer" homepage section
--   * get_daily_best_sellers -> Daily Best Seller from REAL transactions
--                               (orders -> order_items -> SUM(quantity) today)
-- Does NOT touch existing tables' data, other migrations, or storage buckets.

-- ------------------------------------------------------------------
-- 1. categories: sort order (default 0 keeps current name ordering stable)
-- ------------------------------------------------------------------
alter table public.categories
  add column if not exists sort_order integer not null default 0;

create index if not exists categories_sort_order_idx
  on public.categories(sort_order);

-- ------------------------------------------------------------------
-- 2. products: is_popular flag (drives the "Produk Populer" section)
-- ------------------------------------------------------------------
alter table public.products
  add column if not exists is_popular boolean not null default false;

create index if not exists products_is_popular_idx
  on public.products(is_popular);

-- ------------------------------------------------------------------
-- 3. Daily Best Seller — aggregate REAL transactions from today.
--    Security definer: customers only receive the aggregated product
--    info + total_sold, never raw order/customer data.
--    Status "cancelled" excluded (existing status set is
--    pending/processing/shipped/delivered/cancelled).
-- ------------------------------------------------------------------
create or replace function public.get_daily_best_sellers(p_limit integer default 3)
returns table (
  product_id uuid,
  name text,
  slug text,
  price numeric,
  image text,
  category text,
  total_sold bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as product_id,
    p.name,
    p.slug,
    p.price,
    coalesce(p.image_url, '') as image,
    c.name as category,
    sum(oi.quantity)::bigint as total_sold
  from public.products p
  inner join public.order_items oi on oi.product_id = p.id
  inner join public.orders o on o.id = oi.order_id
  left join public.categories c on c.id = p.category_id
  where p.is_active = true
    and o.status <> 'cancelled'
    and o.created_at >= date_trunc('day', now())
  group by p.id, p.name, p.slug, p.price, p.image_url, c.name
  order by total_sold desc
  limit p_limit;
$$;

grant execute on function public.get_daily_best_sellers(integer) to anon, authenticated;
