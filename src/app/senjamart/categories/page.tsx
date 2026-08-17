'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Category } from 'types/category';
import { getCategories } from 'lib/services/categories';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCategories()
      .then((data) => {
        if (!cancelled) setCategories(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          <li className="text-fresh-gray-900">Kategori</li>
        </ol>
      </nav>

      <h1 className="mb-6 text-2xl font-bold text-fresh-gray-900">Kategori</h1>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-lg bg-fresh-gray-100"
            />
          ))}
        </div>
      ) : categories.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/senjamart/categories/${category.slug}`}
              className="group rounded-lg border border-fresh-gray-200 bg-white px-4 py-6 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-fresh-green-600 hover:shadow-md"
            >
              <Image
                src={category.image}
                alt={category.name}
                width={80}
                height={80}
                loading="lazy"
                className="mx-auto mb-3 h-20 w-20 rounded-lg object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div className="text-sm font-medium text-fresh-gray-800 group-hover:text-fresh-green-700">
                {category.name}
              </div>
              <div className="mt-1 text-xs text-fresh-gray-400">
                {category.productCount ?? 0} produk
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-fresh-gray-300 py-16 text-center">
          <span className="text-4xl">🗂️</span>
          <h2 className="text-lg font-semibold text-fresh-gray-900">
            Belum ada kategori
          </h2>
        </div>
      )}
    </div>
  );
}
