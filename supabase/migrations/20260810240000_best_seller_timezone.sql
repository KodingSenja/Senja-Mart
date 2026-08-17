-- ============================================
-- SENJA MART - DAILY BEST SELLER TIMEZONE FIX
-- ============================================
-- The database session timezone is UTC (verified: `show timezone` = UTC)
-- while the storefront targets Indonesian customers (Asia/Jakarta, UTC+7).
-- The previous "today" boundary used date_trunc('day', now()) which splits
-- the day at 07:00 WIB, so orders placed between 00:00-06:59 WIB belonged
-- to the "wrong" day.
--
-- This recreates get_daily_best_sellers() with an explicit Asia/Jakarta
-- day boundary:  [start of today, start of tomorrow) in WIB.
-- No signature/return shape/RLS change; no other objects touched.
--
-- Valid order statuses (existing schema): pending, processing, shipped,
-- delivered, cancelled — only 'cancelled' is excluded from sales.

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
    and o.created_at >= (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta')
    and o.created_at <  ((date_trunc('day', now() at time zone 'Asia/Jakarta') + interval '1 day') at time zone 'Asia/Jakarta')
  group by p.id, p.name, p.slug, p.price, p.image_url, c.name
  order by total_sold desc
  limit p_limit;
$$;

grant execute on function public.get_daily_best_sellers(integer) to anon, authenticated;
