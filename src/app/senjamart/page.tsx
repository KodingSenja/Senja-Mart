'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Fragment, useEffect, useState, useCallback } from 'react';
import type { Category } from 'types/category';
import type { MarketingContent } from 'types/marketing';
import type { DailyBestSeller } from 'types/order';
import type { Product } from 'types/product';
import { getCategories } from 'lib/services/categories';
import { getPopularProducts } from 'lib/services/products';
import { getDailyBestSellers } from 'lib/services/orders';
import { getHeroSlides, getMarketingBanners } from 'lib/services/marketing';
import {
  fallbackHeroSlides,
  fallbackMarketingBanners,
} from 'lib/data/marketing';
import ProductCard from 'components/senjamart/ProductCard';
import { supabase } from 'lib/supabase/client';

/** Map an aggregated best-seller row to the Product shape ProductCard needs. */
function bestSellerToProduct(item: DailyBestSeller): Product {
  return {
    id: item.productId,
    name: item.name,
    slug: item.slug,
    description: '',
    price: item.price,
    compareAtPrice: null,
    image: item.image,
    images: item.image ? [item.image] : [],
    categoryId: null,
    category: null,
    unit: '',
    rating: item.rating,
    reviewCount: item.reviewCount,
    badge: null,
    stock: item.stock,
    featured: false,
    isPopular: false,
  };
}

/**
 * Render a banner description, bolding any "N%" discount pattern to match
 * the original homepage markup (e.g. "Hemat hingga 30%...").
 */
function BannerDescription({ description }: { description?: string | null }) {
  if (!description) return null;
  const parts = description.split(/(\d+%)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\d+%$/.test(part) ? (
          <span key={i} className="font-bold">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const features = [
  {
    icon: (
      <svg
        width="28"
        height="28"
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
    title: 'Belanja 10 Menit',
    description:
      'Pesanan diantar ke depan pintu Anda secepat mungkin dari toko Senja Mart terdekat.',
  },
  {
    icon: (
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 6v-1m0 8v-1m0 8v-1" />
        <path d="M6.5 9.5a4.5 4.5 0 1 0 0 -4.5" />
        <path d="M12 2a4.5 4.5 0 1 1 0 9a4.5 4.5 0 0 1 0 -9" />
        <path d="M17.5 9.5a4.5 4.5 0 1 0 0 -4.5" />
      </svg>
    ),
    title: 'Harga Terbaik & Penawaran',
    description:
      'Harga lebih murah daripada supermarket lokal, plus penawaran cashback terbaik.',
  },
  {
    icon: (
      <svg
        width="28"
        height="28"
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
    title: 'Produk Lengkap',
    description:
      'Lebih dari 5.000 produk mulai dari makanan, perawatan pribadi, hingga kebutuhan rumah tangga.',
  },
  {
    icon: (
      <svg
        width="28"
        height="28"
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
    title: 'Retur Mudah',
    description:
      'Tidak puas dengan produk? Kembalikan di depan pintu dan dapatkan refund dalam hitungan jam.',
  },
];

export default function HomePage() {
  const [slideIndex, setSlideIndex] = useState(0);
  // Development-only initial content. In production the homepage must start
  // empty so marketing sections never flash pre-seeded mock banners.
  const [slides, setSlides] = useState<MarketingContent[]>(() =>
    process.env.NODE_ENV === 'production' ? [] : fallbackHeroSlides,
  );
  const [banners, setBanners] = useState<MarketingContent[]>(() =>
    process.env.NODE_ENV === 'production' ? [] : fallbackMarketingBanners,
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [popular, setPopular] = useState<Product[]>([]);
  const [dailyBest, setDailyBest] = useState<DailyBestSeller[]>([]);
  const [isDailyBestLoading, setIsDailyBestLoading] = useState(true);
  const [dailyBestError, setDailyBestError] = useState<string | null>(null);

  const fetchDailyBestSellers = useCallback(async () => {
    try {
      const bestSellers = await getDailyBestSellers();
      setDailyBest(bestSellers);
      setDailyBestError(null);
    } catch (err) {
      console.error('Error fetching daily best sellers:', err);
      setDailyBestError('Gagal memuat produk terlaris.');
    } finally {
      setIsDailyBestLoading(false);
    }
  }, []);

  useEffect(() => {
    if (slides.length === 0) return;
    const timer = window.setInterval(
      () => setSlideIndex((i) => (i + 1) % slides.length),
      5000,
    );
    return () => window.clearInterval(timer);
  }, [slides.length]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getCategories(),
      getPopularProducts(),
      getHeroSlides(),
      getMarketingBanners(),
      fetchDailyBestSellers(),
    ])
      .then(([cats, prods, heroSlides, marketingBanners]) => {
        if (cancelled) return;
        setCategories(cats);
        setPopular(prods);
        setSlides(heroSlides);
        setBanners(marketingBanners);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchDailyBestSellers]);

  // Realtime subscription for daily best sellers
  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel('daily-best-sellers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          fetchDailyBestSellers();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => {
          fetchDailyBestSellers();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchDailyBestSellers]);

  return (
    <div className="container mx-auto max-w-[1320px] px-4">
      {/* Hero slider */}
      {slides.length > 0 && (
      <section className="mt-8">
        <div
          className="relative overflow-hidden rounded-xl"
          style={{ height: 440 }}
        >
          {slides.map((slide, i) => (
            <div
              key={slide.imageUrl}
              className={`absolute inset-0 flex items-center bg-cover bg-center transition-opacity duration-700 ${
                i === slideIndex ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ backgroundImage: `url(${slide.imageUrl})` }}
            >
              <div className="w-full">
                <div className="flex h-full max-w-xl flex-col justify-center gap-4 p-8 lg:p-12">
                  <span className="inline-block w-fit rounded-lg bg-fresh-yellow-500 px-2 py-1 text-sm font-semibold text-fresh-gray-900">
                    {slide.badge}
                  </span>
                  <h1 className="text-2xl font-bold leading-tight text-fresh-gray-900 lg:text-5xl">
                    {slide.title}
                  </h1>
                  <p className="text-base font-light text-fresh-gray-700">
                    {slide.subtitle}
                  </p>
                  <div className="mt-2">
                    <Link
                      href={slide.ctaUrl ?? '/senjamart/products'}
                      className="inline-flex items-center gap-2 rounded-lg bg-fresh-gray-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-fresh-gray-800"
                    >
                      {slide.ctaText ?? 'Belanja Sekarang'}
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
                        <path d="M5 12l14 0" />
                        <path d="M13 18l6 -6" />
                        <path d="M13 6l6 6" />
                      </svg>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Dots */}
          <div className="absolute bottom-4 left-0 right-0 z-10 flex items-center justify-center gap-2">
            {slides.map((s, i) => (
              <button
                key={s.imageUrl}
                type="button"
                aria-label={`Slide ${i + 1}`}
                onClick={() => setSlideIndex(i)}
                className={`h-2.5 rounded-full transition-all ${
                  i === slideIndex
                    ? 'w-6 bg-fresh-green-600'
                    : 'w-2.5 bg-fresh-gray-300 hover:bg-fresh-gray-400'
                }`}
              />
            ))}
          </div>
        </div>
      </section>
      )}

      {/* Featured categories */}
      <section className="mt-10">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-xl font-bold text-fresh-gray-900">
            Kategori Unggulan
          </h2>
          <Link
            href="/senjamart/categories/semua"
            className="text-sm font-semibold text-fresh-green-700 transition-colors hover:text-fresh-green-600"
          >
            Lihat semua →
          </Link>
        </div>
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
            </Link>
          ))}
        </div>
      </section>

      {/* Promo banners */}
      <section className="mt-10">
        <div className="flex flex-col gap-4 md:flex-row md:gap-6">
          {banners.slice(0, 2).map((banner) => (
            <div
              key={banner.id}
              className="relative w-full overflow-hidden rounded-lg py-10 pl-8 md:w-1/2"
              style={{
                backgroundImage: `url(${banner.imageUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              <div className="flex flex-col gap-2">
                <h2 className="text-xl font-bold text-fresh-gray-900">
                  {banner.title}
                </h2>
                <p className="text-sm">
                  <BannerDescription description={banner.description} />
                </p>
                <Link
                  href={banner.ctaUrl ?? '/senjamart/products'}
                  className="mt-3 inline-flex w-fit items-center rounded-lg bg-fresh-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-fresh-gray-800"
                >
                  {banner.ctaText ?? 'Belanja Sekarang'}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Popular products */}
      <section className="mt-14">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-xl font-bold text-fresh-gray-900">
            Produk Populer
          </h2>
          <Link
            href="/senjamart/products"
            className="text-sm font-semibold text-fresh-green-700 transition-colors hover:text-fresh-green-600"
          >
            Lihat semua →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {popular.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      {/* Daily best sells */}
      <section className="mt-14">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-fresh-gray-900">
            Produk Terlaris Hari Ini
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {banners[2] && (
            <div
              className="flex min-h-[380px] flex-col justify-between rounded-lg p-6"
              style={{
                backgroundImage: `url(${banners[2].imageUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-bold text-white">
                  {banners[2].title}
                </h3>
                <p className="text-sm text-white/90">
                  {banners[2].description}
                </p>
              </div>
              <div>
                <Link
                  href={banners[2].ctaUrl ?? '/senjamart/products'}
                  className="inline-flex items-center rounded-lg bg-fresh-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
                >
                  {banners[2].ctaText ?? 'Belanja Sekarang'}
                </Link>
              </div>
            </div>
          )}

          {isDailyBestLoading ? (
            <div className="flex min-h-[380px] items-center justify-center rounded-lg border border-dashed border-fresh-gray-300 xl:col-span-3">
              <div className="border-t-transparent h-8 w-8 animate-spin rounded-full border-4 border-fresh-green-600"></div>
            </div>
          ) : dailyBestError ? (
            <div className="flex min-h-[380px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-red-300 xl:col-span-3">
              <p className="text-red-600">{dailyBestError}</p>
              <button
                onClick={() => fetchDailyBestSellers()}
                className="text-sm font-semibold text-fresh-green-700 hover:underline"
              >
                Coba lagi
              </button>
            </div>
          ) : dailyBest.length === 0 ? (
            <div className="flex min-h-[380px] items-center justify-center rounded-lg border border-dashed border-fresh-gray-300 xl:col-span-3">
              <p className="text-fresh-gray-500">
                Belum ada produk terlaris hari ini.
              </p>
            </div>
          ) : (
            dailyBest.map((item) => (
              <ProductCard
                key={item.productId}
                product={bestSellerToProduct(item)}
              />
            ))
          )}
        </div>
      </section>

      {/* Features */}
      <section className="mb-14 mt-14">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div key={feature.title} className="flex flex-col gap-3">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-lg bg-fresh-gray-100 text-fresh-green-600">
                {feature.icon}
              </span>
              <h3 className="text-base font-bold text-fresh-gray-900">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-fresh-gray-600">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
