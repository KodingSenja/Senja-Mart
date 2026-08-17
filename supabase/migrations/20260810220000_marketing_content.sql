-- ============================================
-- SENJA MART - MARKETING CONTENT (hero slider + homepage banners)
-- ============================================
-- Adds a single table the storefront homepage uses for:
--   * Hero Slider slides (type = 'hero')
--   * Homepage promo banners (type = 'banner')
-- plus RLS (public reads active rows; admins manage everything) and a
-- public storage bucket "marketing-content" (hero/ + banner/ folders).
-- Does NOT touch existing tables, buckets, functions or policies.

-- ------------------------------------------------------------------
-- 1. marketing_content table
-- ------------------------------------------------------------------
create table public.marketing_content (
  id uuid primary key default gen_random_uuid(),
  type text not null
    constraint marketing_content_type_check check (type in ('hero', 'banner')),
  image_url text not null,
  badge text,
  title text,
  subtitle text,
  description text,
  cta_text text,
  cta_url text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index marketing_content_type_idx on public.marketing_content(type);
create index marketing_content_active_idx on public.marketing_content(is_active);
create index marketing_content_sort_idx on public.marketing_content(sort_order);
-- Composite used by the storefront query (type + active + order).
create index marketing_content_type_active_sort_idx
  on public.marketing_content(type, is_active, sort_order);

create trigger marketing_content_set_updated_at
  before update on public.marketing_content
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- 2. RLS — public reads only active rows; admins manage all rows.
-- Uses the existing public.is_admin() helper (profiles.role = 'admin').
-- ------------------------------------------------------------------
alter table public.marketing_content enable row level security;

create policy "Public can view active marketing content"
  on public.marketing_content for select
  using (is_active = true);

create policy "Admins can view all marketing content"
  on public.marketing_content for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert marketing content"
  on public.marketing_content for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update marketing content"
  on public.marketing_content for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete marketing content"
  on public.marketing_content for delete
  to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------------
-- 3. Storage bucket for marketing assets (hero/ and banner/ folders)
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('marketing-content', 'marketing-content', true)
on conflict (id) do update
  set public = excluded.public;

create policy "Public can view marketing content images"
  on storage.objects for select
  using (bucket_id = 'marketing-content');

create policy "Admins can upload marketing content images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'marketing-content' and public.is_admin());

create policy "Admins can update marketing content images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'marketing-content' and public.is_admin());

create policy "Admins can delete marketing content images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'marketing-content' and public.is_admin());
