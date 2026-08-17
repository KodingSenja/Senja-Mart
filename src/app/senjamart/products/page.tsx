'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Category } from 'types/category';
import type { Product } from 'types/product';
import { getCategories } from 'lib/services/categories';
import { getProducts } from 'lib/services/products';
import ProductCard from 'components/senjamart/ProductCard';

type SortKey = 'default' | 'price-asc' | 'price-desc' | 'rating';

const sortOptions: { value: SortKey; label: string }[] = [
  { value: 'default', label: 'Urutkan: Populer' },
  { value: 'price-asc', label: 'Harga Terendah' },
  { value: 'price-desc', label: 'Harga Tertinggi' },
  { value: 'rating', label: 'Rating Tertinggi' },
];

function ShopContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const q = searchParams.get('q') ?? '';
  const categorySlug = searchParams.get('category') ?? '';

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState(q);
  const [sort, setSort] = useState<SortKey>('default');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getCategories(), getProducts()])
      .then(([cats, prods]) => {
        setCategories(cats);
        setProducts(prods);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Keep the local search box in sync when URL changes (e.g. navbar search).
  useEffect(() => {
    setQuery(q);
  }, [q]);

  const activeCategory = categories.find((c) => c.slug === categorySlug) ?? null;

  const results = useMemo(() => {
    let list = products;
    if (categorySlug) {
      // Match by resolved category id (Supabase UUID) or by slug (seed data).
      list = list.filter(
        (p) =>
          p.category?.slug === categorySlug ||
          p.categoryId === activeCategory?.id ||
          p.categoryId === categorySlug
      );
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          (p.description ?? '').toLowerCase().includes(needle) ||
          (p.category?.name ?? '').toLowerCase().includes(needle)
      );
    }
    switch (sort) {
      case 'price-asc':
        list = [...list].sort((a, b) => a.price - b.price);
        break;
      case 'price-desc':
        list = [...list].sort((a, b) => b.price - a.price);
        break;
      case 'rating':
        list = [...list].sort((a, b) => b.rating - a.rating);
        break;
      default:
        list = [...list].sort(
          (a, b) => Number(b.featured) - Number(a.featured) || b.reviewCount - a.reviewCount
        );
    }
    return list;
  }, [products, categorySlug, q, sort, activeCategory]);

  const updateFilter = (key: 'q' | 'category', value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(`/senjamart/products?${params.toString()}`);
  };

  return (
    <div className="container mx-auto max-w-[1320px] px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-fresh-gray-500" aria-label="Breadcrumb">
        <ol className="flex items-center gap-2">
          <li>
            <Link href="/senjamart" className="hover:text-fresh-green-600">
              Beranda
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-fresh-gray-900">Belanja</li>
        </ol>
      </nav>

      <h1 className="mb-6 text-2xl font-bold text-fresh-gray-900">
        {activeCategory ? activeCategory.name : q ? `Hasil pencarian: "${q}"` : 'Semua Produk'}
      </h1>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-64">
          <div className="rounded-lg border border-fresh-gray-200 p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-fresh-gray-900">
              Kategori
            </h2>
            <ul className="flex flex-col gap-1">
              <li>
                <button
                  type="button"
                  onClick={() => updateFilter('category', '')}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    !categorySlug
                      ? 'bg-fresh-green-50 font-semibold text-fresh-green-700'
                      : 'text-fresh-gray-700 hover:bg-fresh-gray-100'
                  }`}
                >
                  Semua Produk
                  <span className="text-xs text-fresh-gray-400">
                    {products.length}
                  </span>
                </button>
              </li>
              {categories.map((category) => (
                <li key={category.id}>
                  <button
                    type="button"
                    onClick={() => updateFilter('category', category.slug)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      categorySlug === category.slug
                        ? 'bg-fresh-green-50 font-semibold text-fresh-green-700'
                        : 'text-fresh-gray-700 hover:bg-fresh-gray-100'
                    }`}
                  >
                    <span className="line-clamp-2">{category.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-fresh-gray-400">
                      {
                        products.filter(
                          (p) =>
                            p.category?.slug === category.slug ||
                            p.categoryId === category.id
                        ).length
                      }
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Product grid */}
        <div className="flex-1">
          {/* Toolbar */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <label htmlFor="shopSearch" className="sr-only">
                Cari produk
              </label>
              <input
                id="shopSearch"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    updateFilter('q', query);
                  }
                }}
                placeholder="Cari produk..."
                className="w-full rounded-lg border border-fresh-gray-300 px-3 py-2 text-sm text-fresh-gray-900 placeholder:text-fresh-gray-400 focus:border-fresh-green-600 focus:outline-none focus:ring-4 focus:ring-fresh-green-600/25"
              />
              <button
                type="button"
                aria-label="Cari"
                onClick={() => updateFilter('q', query)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-fresh-gray-500 hover:text-fresh-green-600"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
                  <path d="M21 21l-6 -6" />
                </svg>
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-fresh-gray-500">
                {results.length} produk
              </span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="Urutkan produk"
                className="rounded-lg border border-fresh-gray-300 bg-white px-3 py-2 text-sm text-fresh-gray-800 focus:border-fresh-green-600 focus:outline-none focus:ring-4 focus:ring-fresh-green-600/25"
              >
                {sortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-72 animate-pulse rounded-lg bg-fresh-gray-100"
                />
              ))}
            </div>
          ) : results.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {results.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-fresh-gray-300 py-16 text-center">
              <span className="text-4xl">🛒</span>
              <h2 className="text-lg font-semibold text-fresh-gray-900">
                Produk tidak ditemukan
              </h2>
              <p className="max-w-sm text-sm text-fresh-gray-500">
                Coba kata kunci lain atau pilih kategori yang berbeda.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  updateFilter('q', '');
                }}
                className="rounded-lg bg-fresh-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
              >
                Tampilkan Semua Produk
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={null}>
      <ShopContent />
    </Suspense>
  );
}
