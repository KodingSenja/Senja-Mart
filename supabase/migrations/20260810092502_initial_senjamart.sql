-- ============================================
-- SENJA MART - INITIAL DATABASE SCHEMA
-- ============================================

-- PROFILES
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    phone text,
    avatar_url text,
    role text not null default 'customer'
        check (role in ('customer', 'admin')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- CATEGORIES
create table public.categories (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    description text,
    image_url text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- PRODUCTS
create table public.products (
    id uuid primary key default gen_random_uuid(),
    category_id uuid references public.categories(id) on delete set null,
    name text not null,
    slug text not null unique,
    description text,
    price numeric(12,2) not null default 0
        check (price >= 0),
    compare_price numeric(12,2)
        check (compare_price is null or compare_price >= 0),
    stock integer not null default 0
        check (stock >= 0),
    image_url text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- PRODUCT IMAGES
create table public.product_images (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references public.products(id) on delete cascade,
    image_url text not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

-- INDEXES
create index products_category_id_idx
    on public.products(category_id);

create index products_is_active_idx
    on public.products(is_active);

create index product_images_product_id_idx
    on public.product_images(product_id);

-- ENABLE RLS
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;

-- CUSTOMER: boleh melihat kategori aktif
create policy "Anyone can view active categories"
on public.categories
for select
using (is_active = true);

-- CUSTOMER: boleh melihat produk aktif
create policy "Anyone can view active products"
on public.products
for select
using (is_active = true);

-- CUSTOMER: boleh melihat gambar produk
create policy "Anyone can view product images"
on public.product_images
for select
using (
    exists (
        select 1
        from public.products
        where products.id = product_images.product_id
        and products.is_active = true
    )
);

-- USER: bisa melihat profile sendiri
create policy "Users can view own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

-- USER: bisa update profile sendiri
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);