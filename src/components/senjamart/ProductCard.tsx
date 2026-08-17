'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import type { Product, ProductBadge } from 'types/product';
import { useCart } from 'contexts/CartContext';
import { formatRupiah, discountPercent } from 'lib/utils/format';
import Rating from 'components/senjamart/Rating';

const badgeStyles: Record<ProductBadge, { label: string; className: string }> = {
  sale: { label: 'Diskon', className: 'bg-fresh-red-600 text-white' },
  hot: { label: 'Favorit', className: 'bg-orange-500 text-white' },
  new: { label: 'Baru', className: 'bg-fresh-green-600 text-white' },
};

export default function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  const [wishlisted, setWishlisted] = useState(false);

  const discount = discountPercent(product.price, product.compareAtPrice);
  const badge = product.badge ? badgeStyles[product.badge] : null;
  // Stok yang benar-benar bisa dibeli = stock - unit yang di-reserve order lain.
  const available = Math.max(0, product.stock - (product.reservedStock ?? 0));
  const lowStockThreshold = product.lowStockThreshold ?? 5;
  const isLowStock = available > 0 && available <= lowStockThreshold;

  const handleAdd = () => {
    addItem(product, 1);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="group relative rounded-lg border border-fresh-gray-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-fresh-green-600 hover:shadow-lg hover:shadow-fresh-green-600/5">
      <div className="p-3">
        {/* Image + badge + hover actions */}
        <div className="relative flex justify-center text-center">
          {badge && (
            <span
              className={`absolute left-0 top-0 z-10 rounded px-2 py-0.5 text-xs font-semibold ${badge.className}`}
            >
              {badge.label}
              {discount ? ` ${discount}%` : ''}
            </span>
          )}
          <Link href={`/senjamart/products/${product.slug}`} className="block">
            <Image
              src={product.image}
              alt={product.name}
              width={400}
              height={176}
              loading="lazy"
              className="mx-auto h-44 w-full rounded-md object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </Link>

          {/* Quick actions */}
          <div className="absolute bottom-2 right-2 flex flex-col gap-1.5 opacity-0 transition-all duration-200 group-hover:opacity-100">
            <Link
              href={`/senjamart/products/${product.slug}`}
              aria-label="Lihat produk"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-fresh-gray-700 shadow-md transition-colors hover:bg-fresh-green-600 hover:text-white"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
                <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
              </svg>
            </Link>
            <button
              type="button"
              aria-label="Tambah ke wishlist"
              onClick={() => setWishlisted((v) => !v)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg shadow-md transition-colors ${
                wishlisted
                  ? 'bg-fresh-red-600 text-white'
                  : 'bg-white text-fresh-gray-700 hover:bg-fresh-red-600 hover:text-white'
              }`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill={wishlisted ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />
              </svg>
            </button>
          </div>
        </div>

        {/* Info */}
        <div className="mt-3 flex flex-col gap-2">
          {product.category && (
            <Link
              href={`/senjamart/categories/${product.category.slug}`}
              className="text-xs text-fresh-gray-500 transition-colors hover:text-fresh-green-600"
            >
              {product.category.name}
            </Link>
          )}
          <h3 className="truncate text-sm font-semibold text-fresh-gray-900">
            <Link
              href={`/senjamart/products/${product.slug}`}
              className="transition-colors hover:text-fresh-green-600"
            >
              {product.name}
            </Link>
          </h3>
          <div className="flex items-center justify-between">
            <span className="text-xs text-fresh-gray-500">{product.unit}</span>
            {product.stock <= 0 && (
              <span className="rounded bg-fresh-red-50 px-1.5 py-0.5 text-[10px] font-bold text-fresh-red-600">
                Habis
              </span>
            )}
            {isLowStock && (
              <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">
                Stok terbatas
              </span>
            )}
          </div>
          <Rating rating={product.rating} reviewCount={product.reviewCount} />

          {/* Price */}
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-fresh-gray-900">
              {formatRupiah(product.price)}
            </span>
            {product.compareAtPrice && (
              <span className="text-xs text-fresh-gray-400 line-through">
                {formatRupiah(product.compareAtPrice)}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={available <= 0}
            className={`mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              added
                ? 'bg-fresh-green-600 text-white'
                : 'bg-fresh-gray-100 text-fresh-green-700 hover:bg-fresh-green-600 hover:text-white'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {added ? (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12l5 5l10 -10" />
                </svg>
                Ditambahkan
              </>
            ) : (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304z" />
                  <path d="M9 11v-5a3 3 0 0 1 6 0v5" />
                </svg>
                {available > 0 ? 'Tambah' : 'Habis'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
