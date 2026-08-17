export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type PaymentStatus =
  | 'unpaid'
  | 'pending'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'refunded';

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
}

export interface ShippingAddress {
  name: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber?: string | null;
  userId?: string | null;
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  total: number;
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
  shippingAddress?: ShippingAddress | null;
  /** Set saat settlement tidak bisa memenuhi stok (perlu penanganan manual). */
  fulfillmentIssue?: string | null;
  /** Payment attempt terbaru dari midtrans_transactions (bila ada). */
  paymentAttempt?: OrderPaymentAttempt | null;
  createdAt: string;
}

/** Payment attempt dari midtrans_transactions — data aktual, bukan dummy. */
export interface OrderPaymentAttempt {
  /** Midtrans transaction_id (terisi setelah transaksi dibayar/dibuka). */
  transactionId: string | null;
  /** Raw Midtrans transaction_status (pending / settlement / capture / expire / ...). */
  status: string | null;
  /** Amount yang diverifikasi server (orders.total). */
  amount: number;
}

export interface CreateOrderInput {
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  total: number;
  shippingAddress: ShippingAddress;
}

/**
 * Daily Best Seller row — aggregated from real orders/order_items by the
 * `get_daily_best_sellers` RPC. Never exposes order/customer data.
 * `stock`, `rating` and `reviewCount` come from the product row so the
 * ProductCard renders real data (no fabricated values).
 */
export interface DailyBestSeller {
  productId: string;
  name: string;
  slug: string;
  price: number;
  image: string;
  category: string | null;
  totalSold: number;
  stock: number;
  rating: number;
  reviewCount: number;
}
