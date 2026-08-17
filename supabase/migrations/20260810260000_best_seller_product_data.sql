-- ============================================
-- SENJA MART - DAILY BEST SELLER PRODUCT DATA
-- ============================================
-- Extends get_daily_best_sellers() so each best-seller row also carries
-- the product's real `stock`, `rating` and `review_count`. This lets the
-- homepage ProductCard render actual product data instead of hardcoded
-- placeholders (stock: 1, rating: 0, reviewCount: 0).
--
-- Everything else is preserved exactly:
--   * source = orders + order_items (REAL transactions, WIB day boundary)
--   * only non-cancelled orders from today (Asia/Jakarta) are counted
--   * status 'cancelled' excluded
--   * SUM(order_items.quantity) grouped by product, ORDER BY DESC, LIMIT
--   * security definer, search_path = public, no order/customer data exposed
--   * no signature/RLS change; no other objects touched

-- The function's return type (RETURNS TABLE columns) changes vs the previous
-- version, which CREATE OR REPLACE FUNCTION cannot do — drop it first.
DROP FUNCTION IF EXISTS public.get_daily_best_sellers(integer);

create or replace function public.get_daily_best_sellers(p_limit integer default 3)
returns table (
  product_id uuid,
  name text,
  slug text,
  price numeric,
  image text,
  category text,
  total_sold bigint,
  stock integer,
  rating numeric,
  review_count integer
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
    sum(oi.quantity)::bigint as total_sold,
    p.stock,
    p.rating,
    p.review_count
  from public.products p
  inner join public.order_items oi on oi.product_id = p.id
  inner join public.orders o on o.id = oi.order_id
  left join public.categories c on c.id = p.category_id
  where p.is_active = true
    and o.status <> 'cancelled'
    and o.created_at >= (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta')
    and o.created_at <  ((date_trunc('day', now() at time zone 'Asia/Jakarta') + interval '1 day') at time zone 'Asia/Jakarta')
  group by p.id, p.name, p.slug, p.price, p.image_url, p.stock, p.rating, p.review_count, c.name
  order by total_sold desc
  limit p_limit;
$$;

grant execute on function public.get_daily_best_sellers(integer) to anon, authenticated;
