import type { MarketingContent } from 'types/marketing';

/**
 * Fallback marketing content — identical to the values the homepage
 * previously hardcoded (Hero Slider + promo banners + Daily Best Sells
 * side panel). Used only while the `marketing_content` table is empty or
 * Supabase is unavailable, so the homepage never renders empty.
 */
export const fallbackHeroSlides: MarketingContent[] = [
  {
    id: 'mkt-hero-1',
    type: 'hero',
    imageUrl: '/senjamart/slider/slide-1.jpg',
    badge: 'Promo Pembukaan — Diskon 50%',
    title: 'Supermarket Untuk Kebutuhan Segar',
    subtitle:
      'Belanja kebutuhan harian dengan mudah dan nyaman, langsung diantar ke rumah Anda.',
    ctaText: 'Belanja Sekarang',
    ctaUrl: '/senjamart/products',
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'mkt-hero-2',
    type: 'hero',
    imageUrl: '/senjamart/slider/slider-2.jpg',
    badge: 'Gratis Ongkir — min. belanja Rp 300.000',
    title: 'Gratis Ongkir untuk Pesanan di Atas Rp 300.000',
    subtitle:
      'Gratis ongkir untuk pelanggan pertama setelah promo dan diskon diterapkan.',
    ctaText: 'Belanja Sekarang',
    ctaUrl: '/senjamart/products',
    isActive: true,
    sortOrder: 2,
  },
];

export const fallbackMarketingBanners: MarketingContent[] = [
  {
    id: 'mkt-banner-1',
    type: 'banner',
    imageUrl: '/senjamart/banner/grocery-banner.png',
    title: 'Buah & Sayur',
    description: 'Hemat hingga 30% untuk sayur dan buah segar',
    ctaText: 'Belanja Sekarang',
    ctaUrl: '/senjamart/categories/buah-sayur',
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'mkt-banner-2',
    type: 'banner',
    imageUrl: '/senjamart/banner/grocery-banner-2.jpg',
    title: 'Roti & Kue Segar',
    description: 'Hemat hingga 25% untuk roti dan kue pilihan',
    ctaText: 'Belanja Sekarang',
    ctaUrl: '/senjamart/categories/bakery-biskuit',
    isActive: true,
    sortOrder: 2,
  },
  {
    id: 'mkt-banner-3',
    type: 'banner',
    imageUrl: '/senjamart/banner/banner-deal.jpg',
    title: '100% Kopi Organik.',
    description: 'Dapatkan penawaran terbaik sebelum kehabisan!',
    ctaText: 'Belanja Sekarang',
    ctaUrl: '/senjamart/products',
    isActive: true,
    sortOrder: 3,
  },
];
