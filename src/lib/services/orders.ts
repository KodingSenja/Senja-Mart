import type {
  CreateOrderInput,
  DailyBestSeller,
  Order,
  OrderItem,
  OrderStatus,
  PaymentStatus,
} from 'types/order';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

interface OrderItemRow {
  id: string;
  product_id: string | null;
  product_name: string;
  product_image: string | null;
  price: number | string;
  quantity: number;
}

interface MidtransTxnRow {
  transaction_id: string | null;
  status: string;
  amount: number | string;
}

interface OrderRow {
  id: string;
  order_number: string | null;
  user_id: string | null;
  status: string;
  payment_status: string;
  subtotal: number | string;
  shipping_cost: number | string;
  total: number | string;
  shipping_address: Record<string, unknown> | null;
  fulfillment_issue: string | null;
  created_at: string;
  order_items?: OrderItemRow[];
  /** Satu baris per order (unique order_id). RLS: admin lihat semua, customer hanya miliknya. */
  midtrans_transactions?: MidtransTxnRow | MidtransTxnRow[] | null;
}

/** Map a raw Supabase order row (with items) to the app's Order shape. */
function mapOrder(row: OrderRow): Order {
  const items: OrderItem[] = (row.order_items ?? []).map((i) => ({
    productId: i.product_id ?? '',
    name: i.product_name,
    price: Number(i.price) || 0,
    quantity: i.quantity,
    image: i.product_image ?? undefined,
  }));
  const txn = Array.isArray(row.midtrans_transactions)
    ? row.midtrans_transactions[0]
    : row.midtrans_transactions;

  return {
    id: row.id,
    orderNumber: row.order_number ?? null,
    userId: row.user_id,
    items,
    subtotal: Number(row.subtotal) || 0,
    shippingCost: Number(row.shipping_cost) || 0,
    total: Number(row.total) || 0,
    status: (row.status as OrderStatus) ?? 'pending',
    paymentStatus: (row.payment_status as PaymentStatus) ?? 'unpaid',
    shippingAddress: (row.shipping_address ?? null) as unknown as Order['shippingAddress'],
    fulfillmentIssue: row.fulfillment_issue ?? null,
    paymentAttempt: txn
      ? {
          transactionId: txn.transaction_id ?? null,
          status: txn.status ?? null,
          amount: Number(txn.amount) || 0,
        }
      : null,
    createdAt: row.created_at,
  };
}

const SELECT = '*, order_items(*), midtrans_transactions(*)';

/**
 * Create an order atomically on Supabase via the `place_order` RPC:
 * inserts the order + order_items and decrements product stock in one
 * transaction. Requires an authenticated user (checkout is account-based).
 */
export async function createOrder(input: CreateOrderInput): Promise<Order> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase belum dikonfigurasi. Checkout membutuhkan database.'
    );
  }

  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) {
    throw new Error('Silakan masuk terlebih dahulu untuk checkout.');
  }

  const { data: orderId, error } = await supabase.rpc('place_order', {
    p_items: input.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      price: i.price,
    })),
    p_subtotal: input.subtotal,
    p_shipping_cost: input.shippingCost,
    p_total: input.total,
    p_shipping_address: input.shippingAddress,
  });

  if (error) {
    // Translate common DB errors into user friendly messages.
    const message = error.message ?? '';
    if (message.includes('insufficient_stock')) {
      throw new Error('Stok produk tidak mencukupi. Silakan perbarui keranjang.');
    }
    if (message.includes('login_required')) {
      throw new Error('Silakan masuk terlebih dahulu untuk checkout.');
    }
    throw new Error('Gagal membuat pesanan. Silakan coba lagi.');
  }

  const order = await getOrderById(orderId as string);
  if (!order) {
    throw new Error('Gagal memuat pesanan yang baru dibuat.');
  }
  return order;
}

/** Orders visible to the current user (RLS enforces ownership). */
export async function getOrders(): Promise<Order[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }
  const { data, error } = await supabase
    .from('orders')
    .select(SELECT)
    .order('created_at', { ascending: false });
  if (!error && data) {
    return (data as OrderRow[]).map(mapOrder);
  }
  return [];
}

/** All orders — admins see every order via RLS; customers only their own. */
export async function getAdminOrders(): Promise<Order[]> {
  return getOrders();
}

export async function getOrderById(id: string): Promise<Order | null> {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }
  const { data, error } = await supabase
    .from('orders')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (!error && data) {
    return mapOrder(data as OrderRow);
  }
  return null;
}

interface BestSellerRow {
  product_id: string;
  name: string;
  slug: string;
  price: number | string;
  image: string | null;
  category: string | null;
  total_sold: number;
  stock: number;
  rating: number | string | null;
  review_count: number | null;
}

/**
 * Daily Best Seller — products with the most units sold TODAY, aggregated
 * server-side by the security-definer `get_daily_best_sellers` RPC.
 * Only returns aggregated product info (never order/customer data).
 * Returns [] when there are no transactions today (no fake numbers).
 */
export async function getDailyBestSellers(
  limit = 3
): Promise<DailyBestSeller[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase.rpc('get_daily_best_sellers', {
    p_limit: limit,
  });
  // A real RPC failure must be surfaced (homepage shows error + retry),
  // not confused with a legitimate empty day (no orders yet).
  if (error) {
    throw new Error(error.message);
  }
  if (!data) return [];
  return (data as BestSellerRow[]).map((r) => ({
    productId: r.product_id,
    name: r.name,
    slug: r.slug,
    price: Number(r.price) || 0,
    image: r.image ?? '',
    category: r.category ?? null,
    totalSold: Number(r.total_sold) || 0,
    stock: Number(r.stock) || 0,
    rating: Number(r.rating) || 0,
    reviewCount: Number(r.review_count) || 0,
  }));
}

/**
 * Admin: update order status (e.g. processing -> shipped).
 *
 * Pembatalan (status = 'cancelled') TIDAK lewat UPDATE langsung: ia lewat
 * RPC cancel_order yang mengembalikan stok (jika sudah diambil saat paid)
 * atau melepas reservasi (jika belum dibayar) — tepat satu kali, dan selalu
 * dicatat di stock_movements.
 */
export async function updateOrderStatus(
  id: string,
  status: OrderStatus
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  if (status === 'cancelled') {
    const { error } = await supabase.rpc('cancel_order', { p_order_id: id });
    if (error) {
      const message = error.message ?? '';
      if (message.includes('admin_required')) {
        throw new Error('Hanya admin yang bisa membatalkan pesanan.');
      }
      if (message.includes('order_not_found')) {
        throw new Error('Pesanan tidak ditemukan.');
      }
      throw new Error('Gagal membatalkan pesanan. Silakan coba lagi.');
    }
    return;
  }
  const { error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
