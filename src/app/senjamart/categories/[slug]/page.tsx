'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Category } from 'types/category';
import type { Product } from 'types/product';
import { getCategories, getCategoryBySlug } from 'lib/services/categories';
import { getProducts } from 'lib/services/products';
import ProductCard from 'components/senjamart/ProductCard';

export default function CategoryPage() {
  const params = useParams();
  const slug = Array.isArray(params.slug) ? params.slug[0] : (params.slug ?? 'semua');

  const isAll = slug === 'semua';
  const [category, setCategory] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      const all = await getCategories();
      const target = isAll ? null : (await getCategoryBySlug(slug)) ?? null;
      const prods = await getProducts({
        ...(target ? { categoryId: target.id } : {}),
      });
      if (cancelled) return;
      setCategory(target);
      setCategories(all);
      setProducts(prods);
      setLoading(false);
    };
    load().catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug, isAll]);

  return (
    <div className="container mx-auto max-w-[1320px] px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-fresh-gray-500" aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/senjamart" className="hover:text-fresh-green-600">
              Beranda
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-fresh-gray-900">
            {isAll ? 'Kategori' : category?.name ?? 'Kategori'}
          </li>
        </ol>
      </nav>

      <h1 className="mb-2 text-2xl font-bold text-fresh-gray-900">
        {isAll ? 'Semua Kategori' : category?.name ?? 'Kategori'}
      </h1>
      {category?.description && (
        <p className="mb-6 text-sm text-fresh-gray-500">{category.description}</p>
      )}

      {/* Category chips */}
      <div className="mb-8 flex flex-wrap gap-2">
        <Link
          href="/senjamart/categories/semua"
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
            isAll
              ? 'border-fresh-green-600 bg-fresh-green-600 text-white'
              : 'border-fresh-gray-300 text-fresh-gray-700 hover:border-fresh-green-600 hover:text-fresh-green-700'
          }`}
        >
          Semua
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/senjamart/categories/${c.slug}`}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              c.slug === slug
                ? 'border-fresh-green-600 bg-fresh-green-600 text-white'
                : 'border-fresh-gray-300 text-fresh-gray-700 hover:border-fresh-green-600 hover:text-fresh-green-700'
            }`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-lg bg-fresh-gray-100"
            />
          ))}
        </div>
      ) : products.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-fresh-gray-300 py-16 text-center">
          <span className="text-4xl">🧺</span>
          <h2 className="text-lg font-semibold text-fresh-gray-900">
            Belum ada produk di kategori ini
          </h2>
          <Link
            href="/senjamart/products"
            className="rounded-lg bg-fresh-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
          >
            Lihat Semua Produk
          </Link>
        </div>
      )}
    </div>
  );
}
