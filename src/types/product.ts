export type ProductBadge = 'sale' | 'hot' | 'new';

export interface CategoryRef {
  id: string;
  name: string;
  slug: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  compareAtPrice?: number | null;
  image: string;
  images: string[];
  categoryId: string | null;
  category?: CategoryRef | null;
  unit: string;
  rating: number;
  reviewCount: number;
  badge: ProductBadge | null;
  stock: number;
  /** Units currently reserved by unpaid/active orders (internal, admin-facing). */
  reservedStock?: number;
  /** Below this the product is flagged "stok menipis". */
  lowStockThreshold?: number;
  featured: boolean;
  isPopular?: boolean;
  isActive?: boolean;
  createdAt?: string;
}
