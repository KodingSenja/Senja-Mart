'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import type { Product } from 'types/product';
import type { ReviewWithAuthor } from 'types/review';
import { getProductBySlug, getRelatedProducts } from 'lib/services/products';
import { getReviewsByProduct, createReview } from 'lib/services/reviews';
import { useAuth } from 'contexts/AuthContext';
import { formatRupiah, discountPercent } from 'lib/utils/format';
import { useCart } from 'contexts/CartContext';
import Rating from 'components/senjamart/Rating';
import ProductCard from 'components/senjamart/ProductCard';

const benefits = [
  {
    label: 'Pengiriman Cepat',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 16.5l-1.7 1.3a1.5 1.5 0 0 1 -1.8 0l-1.7 -1.3" />
        <path d="M21 16.5l-1.7 1.3a1.5 1.5 0 0 1 -1.8 0l-1.7 -1.3" />
        <path d="M2.7 14.5a1.5 1.5 0 0 1 .8 -1.3l1.6 -.9a1.5 1.5 0 0 0 .8 -1.3v-4a5 5 0 0 1 5 -5h3a5 5 0 0 1 5 5v4a1.5 1.5 0 0 0 .8 1.3l1.6 .9a1.5 1.5 0 0 1 .8 1.3v2a1.5 1.5 0 0 1 -1.5 1.5h-17a1.5 1.5 0 0 1 -1.5 -1.5z" />
      </svg>
    ),
  },
  {
    label: 'Retur Mudah',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12a9 9 0 1 0 9 -9a9.75 9.75 0 0 0 -6.74 2.74l-2.26 -2.25v6h6" />
      </svg>
    ),
  },
  {
    label: 'Pembayaran Aman',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
];

export default function ProductDetailPage() {
  const params = useParams();
  const slug = Array.isArray(params.slug) ? params.slug[0] : (params.slug ?? '');

  const { addItem } = useCart();
  const { user } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [reviews, setReviews] = useState<ReviewWithAuthor[]>([]);
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProductBySlug(slug)
      .then(async (found) => {
        if (cancelled || !found) return;
        setProduct(found);
        setActiveImage(0);
        setQuantity(1);
        const [rel, revs] = await Promise.all([
          getRelatedProducts(found),
          getReviewsByProduct(found.id),
        ]);
        if (!cancelled) {
          setRelated(rel);
          setReviews(revs);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleReviewSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setReviewError(null);
    try {
      await createReview({
        productId: product.id,
        rating: reviewRating,
        review: reviewText.trim() || undefined,
      });
      setReviewText('');
      setReviewSubmitted(true);
      setReviews(await getReviewsByProduct(product.id));
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Gagal mengirim ulasan.');
    }
  };

  if (!product) {
    return (
      <div className="container mx-auto max-w-[1320px] px-4 py-20 text-center">
        <span className="text-4xl">🔍</span>
        <h1 className="mt-4 text-xl font-bold text-fresh-gray-900">
          Produk tidak ditemukan
        </h1>
        <p className="mt-2 text-sm text-fresh-gray-500">
          Produk yang Anda cari mungkin sudah tidak tersedia.
        </p>
        <Link
          href="/senjamart/products"
          className="mt-6 inline-flex items-center rounded-lg bg-fresh-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
        >
          Kembali ke Belanja
        </Link>
      </div>
    );
  }

  const discount = discountPercent(product.price, product.compareAtPrice);
  const images = product.images.length > 0 ? product.images : [product.image];
  // Stok yang benar-benar bisa dibeli = stock - unit yang di-reserve order lain.
  const available = Math.max(0, product.stock - (product.reservedStock ?? 0));
  const lowStockThreshold = product.lowStockThreshold ?? 5;
  const isLowStock = available > 0 && available <= lowStockThreshold;

  const handleAdd = () => {
    addItem(product, quantity);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  };

  return (
    <div className="container mx-auto max-w-[1320px] px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-8 text-sm text-fresh-gray-500" aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/senjamart" className="hover:text-fresh-green-600">
              Beranda
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/senjamart/products" className="hover:text-fresh-green-600">
              Belanja
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-fresh-gray-900">{product.name}</li>
        </ol>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Gallery */}
        <div className="flex flex-col-reverse gap-4 sm:flex-row">
          <div className="flex gap-3 sm:flex-col">
            {images.map((img, i) => (
              <button
                key={img}
                type="button"
                aria-label={`Gambar ${i + 1}`}
                onClick={() => setActiveImage(i)}
                className={`w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                  i === activeImage
                    ? 'border-fresh-green-600'
                    : 'border-transparent hover:border-fresh-gray-300'
                }`}
              >
                <Image
                  src={img}
                  alt={`${product.name} ${i + 1}`}
                  width={80}
                  height={80}
                  className="h-20 w-full object-cover"
                />
              </button>
            ))}
          </div>
          <div className="relative aspect-square flex-1 overflow-hidden rounded-lg border border-fresh-gray-200">
            <Image
              src={images[activeImage]}
              alt={product.name}
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
            {discount && (
              <span className="absolute left-3 top-3 rounded bg-fresh-red-600 px-2 py-1 text-xs font-semibold text-white">
                Diskon {discount}%
              </span>
            )}
          </div>
        </div>

        {/* Info */}
        <div>
          {product.category && (
            <Link
              href={`/senjamart/categories/${product.category.slug}`}
              className="text-sm font-medium text-fresh-green-700 hover:text-fresh-green-600"
            >
              {product.category.name}
            </Link>
          )}
          <h1 className="mt-1 text-2xl font-bold text-fresh-gray-900 lg:text-3xl">
            {product.name}
          </h1>

          <div className="mt-3 flex items-center gap-3">
            <Rating rating={product.rating} reviewCount={product.reviewCount} />
            <span className="text-sm text-fresh-gray-500">• {product.unit}</span>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <span className="text-3xl font-bold text-fresh-gray-900">
              {formatRupiah(product.price)}
            </span>
            {product.compareAtPrice && (
              <span className="text-base text-fresh-gray-400 line-through">
                {formatRupiah(product.compareAtPrice)}
              </span>
            )}
            {discount && (
              <span className="rounded bg-fresh-red-50 px-2 py-1 text-xs font-semibold text-fresh-red-600">
                Hemat {discount}%
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`inline-flex items-center gap-1.5 ${
                available > 0 ? 'text-fresh-green-700' : 'text-fresh-red-600'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  available > 0 ? 'bg-fresh-green-600' : 'bg-fresh-red-600'
                }`}
              />
              {available > 0
                ? `Stok tersedia: ${available}`
                : 'Stok habis'}
            </span>
            {isLowStock && (
              <span className="rounded bg-orange-50 px-2 py-0.5 text-xs font-bold text-orange-600">
                Stok terbatas
              </span>
            )}
          </div>

          <p className="mt-5 leading-relaxed text-fresh-gray-600">
            {product.description}
          </p>

          {/* Quantity + Add */}
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <div className="flex items-center rounded-lg border border-fresh-gray-300">
              <button
                type="button"
                aria-label="Kurangi jumlah"
                onClick={() => setQuantity((n) => Math.max(1, n - 1))}
                className="px-4 py-2.5 text-lg font-semibold text-fresh-gray-700 transition-colors hover:bg-fresh-gray-100"
              >
                −
              </button>
              <span className="w-12 text-center text-base font-semibold text-fresh-gray-900">
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Tambah jumlah"
                onClick={() => setQuantity((n) => Math.min(available || 99, n + 1))}
                className="px-4 py-2.5 text-lg font-semibold text-fresh-gray-700 transition-colors hover:bg-fresh-gray-100"
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={handleAdd}
              disabled={available <= 0}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                added ? 'bg-fresh-green-700' : 'bg-fresh-green-600 hover:bg-fresh-green-700'
              }`}
            >
              {added ? (
                <>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12l5 5l10 -10" />
                  </svg>
                  Ditambahkan ke Keranjang
                </>
              ) : (
                <>
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
                    <path d="M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304z" />
                    <path d="M9 11v-5a3 3 0 0 1 6 0v5" />
                  </svg>
                  {available > 0 ? 'Tambah ke Keranjang' : 'Stok Habis'}
                </>
              )}
            </button>
          </div>

          {/* Benefits */}
          <div className="mt-8 grid grid-cols-3 gap-3 border-t border-fresh-gray-200 pt-6">
            {benefits.map((b) => (
              <div
                key={b.label}
                className="flex flex-col items-center gap-2 text-center"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-fresh-gray-100 text-fresh-green-600">
                  {b.icon}
                </span>
                <span className="text-xs font-medium text-fresh-gray-600">
                  {b.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reviews */}
      <section className="mt-16">
        <h2 className="mb-6 text-xl font-bold text-fresh-gray-900">
          Ulasan ({reviews.length})
        </h2>

        {user ? (
          <form
            onSubmit={handleReviewSubmit}
            className="mb-8 rounded-lg border border-fresh-gray-200 p-5"
          >
            <h3 className="mb-3 text-sm font-bold text-fresh-gray-900">
              Tulis ulasan Anda
            </h3>
            <div className="mb-3 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`${star} bintang`}
                  onClick={() => setReviewRating(star)}
                  className={`text-xl transition-transform hover:scale-125 ${
                    star <= reviewRating
                      ? 'text-fresh-yellow-500'
                      : 'text-fresh-gray-300'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Bagaimana kualitas produk ini?"
              className="w-full rounded-lg border border-fresh-gray-300 px-3 py-2.5 text-sm text-fresh-gray-900 placeholder:text-fresh-gray-400 focus:border-fresh-green-600 focus:outline-none focus:ring-4 focus:ring-fresh-green-600/25"
            />
            {reviewError && (
              <div className="mt-3 rounded-lg bg-fresh-red-50 px-4 py-2.5 text-xs font-medium text-fresh-red-600">
                {reviewError}
              </div>
            )}
            {reviewSubmitted && (
              <div className="mt-3 rounded-lg bg-fresh-green-50 px-4 py-2.5 text-xs font-medium text-fresh-green-800">
                Terima kasih! Ulasan Anda tersimpan ✅
              </div>
            )}
            <button
              type="submit"
              className="mt-3 rounded-lg bg-fresh-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
            >
              Kirim Ulasan
            </button>
          </form>
        ) : (
          <p className="mb-8 text-sm text-fresh-gray-500">
            <Link
              href={`/senjamart/login?redirect=/senjamart/products/${product.slug}`}
              className="font-semibold text-fresh-green-700 hover:text-fresh-green-600"
            >
              Masuk
            </Link>{' '}
            untuk menulis ulasan.
          </p>
        )}

        {reviews.length === 0 ? (
          <p className="text-sm text-fresh-gray-500">
            Belum ada ulasan untuk produk ini.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {reviews.map((review) => (
              <div
                key={review.id}
                className="rounded-lg border border-fresh-gray-200 p-5"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-fresh-gray-100 text-xs font-bold text-fresh-green-700">
                      {(review.authorName || 'U').charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm font-semibold text-fresh-gray-900">
                      {review.authorName || 'Pengguna'}
                    </span>
                  </div>
                  <Rating rating={review.rating} showCount={false} />
                </div>
                {review.review && (
                  <p className="text-sm leading-relaxed text-fresh-gray-600">
                    {review.review}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Related products */}
      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-6 text-xl font-bold text-fresh-gray-900">
            Produk Serupa
          </h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
