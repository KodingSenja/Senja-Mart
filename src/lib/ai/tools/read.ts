/**
 * READ tools — read-only access to real Supabase data through the signed-in
 * user's own session (RLS enforced). No tool ever writes.
 */

import type { AgentContext, ToolResult } from '../types';
import {
  aggregateRevenue,
  customerName,
  dailyRevenueSeries,
  daysAgoStartUTC,
  fetchCategories,
  fetchCustomerCount,
  fetchOrderById,
  fetchOrders,
  fetchProducts,
  isRevenueOrder,
  isUuid,
  num,
  startOfJakartaMonthUTC,
  topProductsFromOrders,
  type OrderRow,
} from './db';

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const err = (message: string): ToolResult => ({ ok: false, error: message });

function periodRange(period: string): { from?: string; label: string; days?: number } {
  switch (period) {
    case 'today':
      return { from: daysAgoStartUTC(0), label: 'hari ini', days: 1 };
    case '7d':
      return { from: daysAgoStartUTC(6), label: '7 hari terakhir', days: 7 };
    case '30d':
      return { from: daysAgoStartUTC(29), label: '30 hari terakhir', days: 30 };
    case 'thisMonth':
      return { from: startOfJakartaMonthUTC(), label: 'bulan ini' };
    case 'all':
      return { label: 'semua waktu' };
    default:
      return { from: daysAgoStartUTC(29), label: '30 hari terakhir', days: 30 };
  }
}

export async function getDashboardSummary(ctx: AgentContext): Promise<ToolResult> {
  try {
    const [orders, products, categories] = await Promise.all([
      fetchOrders(ctx.supabase, { limit: 200 }),
      fetchProducts(ctx.supabase, { includeInactive: true, limit: 300 }),
      fetchCategories(ctx.supabase, 100),
    ]);
    const counts: Record<string, number> = {
      pending: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0,
    };
    for (const o of orders) {
      if (Object.prototype.hasOwnProperty.call(counts, o.status)) counts[o.status] += 1;
    }
    const rev = aggregateRevenue(orders);
    const lowStock = products.filter(
      (p) => p.stock <= num(p.low_stock_threshold)
    );
    const recent = orders.slice(0, 5).map((o) => ({
      orderNumber: o.order_number ?? o.id.slice(0, 8).toUpperCase(),
      customer: customerName(o),
      total: num(o.total),
      status: o.status,
      paymentStatus: o.payment_status,
      createdAt: o.created_at,
    }));
    return ok({
      totalProducts: products.length,
      activeProducts: products.filter((p) => p.is_active).length,
      totalCategories: categories.length,
      totalOrders: orders.length,
      ordersByStatus: counts,
      omzet: rev.omzet,
      paidOrders: rev.paidCount,
      lowStockCount: lowStock.filter((p) => p.stock > 0).length,
      outOfStockCount: lowStock.filter((p) => p.stock <= 0).length,
      recentOrders: recent,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat ringkasan dashboard');
  }
}

export async function getRevenue(
  ctx: AgentContext,
  args: { period?: string; compare?: boolean }
): Promise<ToolResult> {
  try {
    const period = typeof args.period === 'string' ? args.period : '30d';
    const range = periodRange(period);
    const current = await fetchOrders(ctx.supabase, { from: range.from, limit: 500 });
    const rev = aggregateRevenue(current);
    let prev = null;
    const wantCompare = args.compare !== false;
    if (wantCompare && range.from) {
      const fromMs = new Date(range.from).getTime();
      const toMs = Date.now();
      const duration = toMs - fromMs;
      const prevFrom = new Date(fromMs - duration).toISOString();
      const prevTo = range.from;
      const prevRows = await fetchOrders(ctx.supabase, { from: prevFrom, to: prevTo, limit: 500 });
      const prevRev = aggregateRevenue(prevRows);
      prev = {
        omzet: prevRev.omzet,
        orderCount: prevRev.orderCount,
        changePercent: prevRev.omzet > 0 ? ((rev.omzet - prevRev.omzet) / prevRev.omzet) * 100 : null,
      };
    }
    return ok({
      period: range.label,
      omzet: rev.omzet,
      orderCount: rev.orderCount,
      paidCount: rev.paidCount,
      avgOrderValue: rev.paidCount > 0 ? rev.omzet / rev.paidCount : 0,
      comparison: prev,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal menghitung omzet');
  }
}

export async function getOrders(
  ctx: AgentContext,
  args: { status?: string; payment_status?: string; search?: string; limit?: number }
): Promise<ToolResult> {
  try {
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
    const rows = await fetchOrders(ctx.supabase, {
      status: args.status,
      paymentStatus: args.payment_status,
      search: args.search,
      limit,
    });
    return ok(
      rows.map((o) => ({
        id: o.id,
        orderNumber: o.order_number ?? o.id.slice(0, 8).toUpperCase(),
        customer: customerName(o),
        total: num(o.total),
        status: o.status,
        paymentStatus: o.payment_status,
        createdAt: o.created_at,
        itemCount: (o.order_items ?? []).reduce((n, i) => n + i.quantity, 0),
      }))
    );
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat pesanan');
  }
}

export async function getOrderDetail(
  ctx: AgentContext,
  args: { order_id?: string }
): Promise<ToolResult> {
  if (!isUuid(args.order_id)) {
    return err('order_id tidak valid (harus UUID).');
  }
  try {
    const order = await fetchOrderById(ctx.supabase, args.order_id as string);
    if (!order) return err('Pesanan tidak ditemukan.');
    const txn = Array.isArray(order.midtrans_transactions)
      ? order.midtrans_transactions[0]
      : order.midtrans_transactions;
    return ok({
      id: order.id,
      orderNumber: order.order_number ?? order.id.slice(0, 8).toUpperCase(),
      customer: customerName(order),
      status: order.status,
      paymentStatus: order.payment_status,
      subtotal: num(order.subtotal),
      shippingCost: num(order.shipping_cost),
      total: num(order.total),
      createdAt: order.created_at,
      shippingAddress: order.shipping_address ?? null,
      fulfillmentIssue: order.fulfillment_issue ?? null,
      items: (order.order_items ?? []).map((i) => ({
        productId: i.product_id,
        name: i.product_name,
        price: num(i.price),
        quantity: i.quantity,
      })),
      paymentAttempt: txn
        ? {
            transactionId: txn.transaction_id ?? null,
            status: txn.status ?? null,
            amount: num(txn.amount),
          }
        : null,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat detail pesanan');
  }
}

export async function getProducts(
  ctx: AgentContext,
  args: { search?: string; category_id?: string; include_inactive?: boolean; limit?: number }
): Promise<ToolResult> {
  try {
    const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
    const rows = await fetchProducts(ctx.supabase, {
      search: args.search,
      categoryId: args.category_id,
      includeInactive: args.include_inactive,
      limit,
    });
    return ok(
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: num(p.price),
        stock: num(p.stock),
        reservedStock: num(p.reserved_stock),
        lowStockThreshold: num(p.low_stock_threshold),
        isActive: p.is_active,
        isPopular: p.is_popular,
        featured: p.featured,
        badge: p.badge ?? null,
      }))
    );
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat produk');
  }
}

export async function getCategories(
  ctx: AgentContext,
  args: { limit?: number }
): Promise<ToolResult> {
  try {
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 100);
    const rows = await fetchCategories(ctx.supabase, limit);
    return ok(rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug, isActive: c.is_active })));
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat kategori');
  }
}

export async function getInventory(
  ctx: AgentContext,
  args: { status?: string; limit?: number }
): Promise<ToolResult> {
  try {
    const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 100);
    const rows = await fetchProducts(ctx.supabase, { includeInactive: true, limit: 300 });
    const status = args.status;
    const filtered = status
      ? rows.filter((p) => {
          const s = p.stock <= 0 ? 'out' : p.stock <= num(p.low_stock_threshold) ? 'low' : 'safe';
          return s === status;
        })
      : rows;
    const list = filtered.slice(0, limit).map((p) => ({
      id: p.id,
      name: p.name,
      stock: num(p.stock),
      reservedStock: num(p.reserved_stock),
      lowStockThreshold: num(p.low_stock_threshold),
      available: Math.max(0, num(p.stock) - num(p.reserved_stock)),
      status: p.stock <= 0 ? 'out' : p.stock <= num(p.low_stock_threshold) ? 'low' : 'safe',
      isActive: p.is_active,
    }));
    return ok({
      status: status ?? 'all',
      count: list.length,
      products: list,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat inventory');
  }
}

export async function getSalesAnalytics(
  ctx: AgentContext,
  args: { period?: string }
): Promise<ToolResult> {
  try {
    const period = typeof args.period === 'string' ? args.period : '30d';
    const range = periodRange(period);
    const days = range.days ?? 30;
    const rows = await fetchOrders(ctx.supabase, { from: range.from, limit: 500 });
    const rev = aggregateRevenue(rows);
    return ok({
      period: range.label,
      omzet: rev.omzet,
      orderCount: rev.orderCount,
      paidCount: rev.paidCount,
      dailyRevenue: dailyRevenueSeries(rows, days),
      topProducts: topProductsFromOrders(rows, 5),
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat analitik penjualan');
  }
}

export async function getTopProducts(
  ctx: AgentContext,
  args: { period?: string; limit?: number }
): Promise<ToolResult> {
  try {
    const period = typeof args.period === 'string' ? args.period : '30d';
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
    const range = periodRange(period);
    const rows = await fetchOrders(ctx.supabase, { from: range.from, limit: 500 });
    return ok({ period: range.label, topProducts: topProductsFromOrders(rows, limit) });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat produk terlaris');
  }
}

export async function getLowStockProducts(
  ctx: AgentContext,
  args: { limit?: number }
): Promise<ToolResult> {
  try {
    const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 50);
    const rows = await fetchProducts(ctx.supabase, { includeInactive: true, limit: 300 });
    const low = rows
      .filter((p) => num(p.stock) <= num(p.low_stock_threshold))
      .sort((a, b) => num(a.stock) - num(b.stock))
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        name: p.name,
        stock: num(p.stock),
        reservedStock: num(p.reserved_stock),
        lowStockThreshold: num(p.low_stock_threshold),
        available: Math.max(0, num(p.stock) - num(p.reserved_stock)),
        status: num(p.stock) <= 0 ? 'out' : 'low',
      }));
    return ok({ count: low.length, products: low });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat produk stok menipis');
  }
}

export async function getCustomerSummary(
  ctx: AgentContext,
  args: { limit?: number }
): Promise<ToolResult> {
  try {
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
    const [totalCustomers, orders] = await Promise.all([
      fetchCustomerCount(ctx.supabase),
      fetchOrders(ctx.supabase, { limit: 500 }),
    ]);
    const byCustomer = new Map<string, { name: string; orders: number; omzet: number }>();
    for (const o of orders) {
      const name = customerName(o) ?? o.user_id ?? 'Tanpa nama';
      const cur = byCustomer.get(name) ?? { name, orders: 0, omzet: 0 };
      cur.orders += 1;
      if (isRevenueOrder(o)) cur.omzet += num(o.total);
      byCustomer.set(name, cur);
    }
    const top = [...byCustomer.values()]
      .sort((a, b) => b.omzet - a.omzet || b.orders - a.orders)
      .slice(0, limit);
    return ok({
      totalCustomers,
      customersWithOrders: byCustomer.size,
      totalOrders: orders.length,
      topCustomers: top,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat ringkasan customer');
  }
}

export async function getPaymentStatus(ctx: AgentContext): Promise<ToolResult> {
  try {
    const rows = await fetchOrders(ctx.supabase, { limit: 500 });
    const counts: Record<string, number> = {};
    for (const o of rows) {
      counts[o.payment_status] = (counts[o.payment_status] ?? 0) + 1;
    }
    const unpaid = rows
      .filter((o) => o.payment_status !== 'paid' && o.payment_status !== 'refunded')
      .slice(0, 10)
      .map((o) => ({
        id: o.id,
        orderNumber: o.order_number ?? o.id.slice(0, 8).toUpperCase(),
        customer: customerName(o),
        total: num(o.total),
        paymentStatus: o.payment_status,
        createdAt: o.created_at,
      }));
    return ok({ counts, unpaidOrders: unpaid });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat status pembayaran');
  }
}

export async function getRefundStatus(ctx: AgentContext): Promise<ToolResult> {
  try {
    const rows = await fetchOrders(ctx.supabase, { paymentStatus: 'refunded', limit: 50 });
    return ok({
      refundedCount: rows.length,
      refundedOrders: rows.map((o) => ({
        id: o.id,
        orderNumber: o.order_number ?? o.id.slice(0, 8).toUpperCase(),
        customer: customerName(o),
        total: num(o.total),
        createdAt: o.created_at,
      })),
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal memuat status refund');
  }
}

/** Map READ tool name → handler. */
export const readHandlers: Record<
  string,
  (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolResult>
> = {
  get_dashboard_summary: getDashboardSummary,
  get_revenue: getRevenue,
  get_orders: getOrders,
  get_order_detail: getOrderDetail,
  get_products: getProducts,
  get_categories: getCategories,
  get_inventory: getInventory,
  get_sales_analytics: getSalesAnalytics,
  get_top_products: getTopProducts,
  get_low_stock_products: getLowStockProducts,
  get_customer_summary: getCustomerSummary,
  get_payment_status: getPaymentStatus,
  get_refund_status: getRefundStatus,
};
