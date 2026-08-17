/**
 * ANALYSIS tools — compute structured analysis from REAL data only.
 *
 * Every number in these results comes from Supabase. The tools surface
 * observations (trends, comparisons, anomalies, urgency) as data; the LLM
 * turns them into prose using cautious language ("Data menunjukkan...",
 * "Kemungkinan penyebab...").
 */

import type { AgentContext, ToolResult } from '../types';
import {
  aggregateRevenue,
  dailyRevenueSeries,
  daysAgoStartUTC,
  fetchCategories,
  fetchOrders,
  fetchProducts,
  isRevenueOrder,
  num,
  startOfJakartaMonthUTC,
  topProductsFromOrders,
  type OrderRow,
} from './db';

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const err = (message: string): ToolResult => ({ ok: false, error: message });

const ORDERS_STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  processing: 'Diproses',
  shipped: 'Dikirim',
  delivered: 'Selesai',
  cancelled: 'Dibatalkan',
};

function periodWindow(period: string): { from: string; days: number; label: string } {
  switch (period) {
    case 'today':
      return { from: daysAgoStartUTC(0), days: 1, label: 'hari ini' };
    case '7d':
      return { from: daysAgoStartUTC(6), days: 7, label: '7 hari terakhir' };
    case '30d':
      return { from: daysAgoStartUTC(29), days: 30, label: '30 hari terakhir' };
    case 'thisMonth':
      return { from: startOfJakartaMonthUTC(), days: 30, label: 'bulan ini' };
    default:
      return { from: daysAgoStartUTC(29), days: 30, label: '30 hari terakhir' };
  }
}

/** Previous window of equal duration, immediately before `from`. */
function prevWindow(from: string): { from: string; to: string } {
  const fromMs = new Date(from).getTime();
  const nowMs = Date.now();
  const duration = nowMs - fromMs;
  return {
    from: new Date(fromMs - duration).toISOString(),
    to: from,
  };
}

function statusDistribution(rows: OrderRow[]): Record<string, number> {
  const counts: Record<string, number> = {
    pending: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0,
  };
  for (const o of rows) {
    if (Object.prototype.hasOwnProperty.call(counts, o.status)) counts[o.status] += 1;
  }
  return counts;
}

function paymentDistribution(rows: OrderRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of rows) {
    counts[o.payment_status] = (counts[o.payment_status] ?? 0) + 1;
  }
  return counts;
}

export async function analyzeSales(
  ctx: AgentContext,
  args: { period?: string }
): Promise<ToolResult> {
  try {
    const period = typeof args.period === 'string' ? args.period : '30d';
    const win = periodWindow(period);
    const [current, previous] = await Promise.all([
      fetchOrders(ctx.supabase, { from: win.from, limit: 500 }),
      fetchOrders(ctx.supabase, { ...prevWindow(win.from), limit: 500 }),
    ]);
    const rev = aggregateRevenue(current);
    const prev = aggregateRevenue(previous);
    const topProducts = topProductsFromOrders(current, 10);

    // Category mapping for top categories (real product → category mapping).
    const [products, categories] = await Promise.all([
      fetchProducts(ctx.supabase, { includeInactive: true, limit: 300 }),
      fetchCategories(ctx.supabase, 100),
    ]);
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const catOfProduct = new Map(
      products.map((p) => [p.id, p.category_id ? (catName.get(p.category_id) ?? 'Tanpa Kategori') : 'Tanpa Kategori'])
    );
    const catAgg = new Map<string, { quantitySold: number; revenue: number }>();
    for (const o of current) {
      if (!isRevenueOrder(o)) continue;
      for (const item of o.order_items ?? []) {
        const cat = item.product_id ? (catOfProduct.get(item.product_id) ?? 'Tanpa Kategori') : 'Tanpa Kategori';
        const cur = catAgg.get(cat) ?? { quantitySold: 0, revenue: 0 };
        cur.quantitySold += item.quantity;
        cur.revenue += num(item.price) * item.quantity;
        catAgg.set(cat, cur);
      }
    }
    const topCategories = [...catAgg.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
      .slice(0, 5);

    return ok({
      period: win.label,
      omzet: rev.omzet,
      orderCount: rev.orderCount,
      paidCount: rev.paidCount,
      avgOrderValue: rev.paidCount > 0 ? rev.omzet / rev.paidCount : 0,
      vsPreviousPeriod: {
        omzet: prev.omzet,
        orderCount: prev.orderCount,
        omzetChangePercent:
          prev.omzet > 0 ? ((rev.omzet - prev.omzet) / prev.omzet) * 100 : null,
        orderChangePercent:
          prev.orderCount > 0
            ? ((rev.orderCount - prev.orderCount) / prev.orderCount) * 100
            : null,
      },
      dailyRevenue: dailyRevenueSeries(current, win.days),
      topProducts,
      topCategories,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal menganalisis penjualan');
  }
}

export async function analyzeRevenue(
  ctx: AgentContext,
  args: { period?: string }
): Promise<ToolResult> {
  try {
    const period = typeof args.period === 'string' ? args.period : '30d';
    const win = periodWindow(period);
    const [current, previous] = await Promise.all([
      fetchOrders(ctx.supabase, { from: win.from, limit: 500 }),
      fetchOrders(ctx.supabase, { ...prevWindow(win.from), limit: 500 }),
    ]);
    const rev = aggregateRevenue(current);
    const prev = aggregateRevenue(previous);
    const daily = dailyRevenueSeries(current, win.days);
    const withRevenue = daily.filter((d) => d.revenue > 0);
    const bestDay = withRevenue.length
      ? withRevenue.reduce((a, b) => (b.revenue > a.revenue ? b : a))
      : null;

    return ok({
      period: win.label,
      omzet: rev.omzet,
      orderCount: rev.orderCount,
      paidCount: rev.paidCount,
      avgOrderValue: rev.paidCount > 0 ? rev.omzet / rev.paidCount : 0,
      comparison: {
        prevOmzet: prev.omzet,
        changePercent:
          prev.omzet > 0 ? ((rev.omzet - prev.omzet) / prev.omzet) * 100 : null,
      },
      bestDay,
      daysWithSales: withRevenue.length,
      totalDays: daily.length,
      dailyRevenue: daily,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal menganalisis omzet');
  }
}

export async function analyzeInventory(ctx: AgentContext): Promise<ToolResult> {
  try {
    const products = await fetchProducts(ctx.supabase, { includeInactive: true, limit: 300 });
    const out = products.filter((p) => num(p.stock) <= 0);
    const low = products.filter((p) => num(p.stock) > 0 && num(p.stock) <= num(p.low_stock_threshold));
    const safe = products.filter((p) => num(p.stock) > num(p.low_stock_threshold));
    const reservedTotal = products.reduce((s, p) => s + num(p.reserved_stock), 0);
    return ok({
      totalProducts: products.length,
      activeProducts: products.filter((p) => p.is_active).length,
      outOfStockCount: out.length,
      lowStockCount: low.length,
      safeCount: safe.length,
      reservedTotalUnits: reservedTotal,
      outOfStockProducts: out
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 20)
        .map((p) => ({ id: p.id, name: p.name, stock: num(p.stock) })),
      lowStockProducts: low
        .sort((a, b) => num(a.stock) - num(b.stock))
        .slice(0, 20)
        .map((p) => ({
          id: p.id,
          name: p.name,
          stock: num(p.stock),
          lowStockThreshold: num(p.low_stock_threshold),
          reservedStock: num(p.reserved_stock),
        })),
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal menganalisis inventory');
  }
}

export async function analyzeOrders(ctx: AgentContext): Promise<ToolResult> {
  try {
    const orders = await fetchOrders(ctx.supabase, { limit: 500 });
    const status = statusDistribution(orders);
    const payment = paymentDistribution(orders);
    const rev = aggregateRevenue(orders);
    const unpaid = orders.filter((o) => o.payment_status !== 'paid' && o.payment_status !== 'refunded');
    const unpaidValue = unpaid.reduce((s, o) => s + num(o.total), 0);
    return ok({
      totalOrders: orders.length,
      ordersByStatus: status,
      ordersByStatusLabel: Object.fromEntries(
        Object.entries(status).map(([k, v]) => [ORDERS_STATUS_LABEL[k] ?? k, v])
      ),
      paymentsByStatus: payment,
      paidCount: rev.paidCount,
      unpaidCount: unpaid.length,
      unpaidValue,
      avgOrderValue: rev.paidCount > 0 ? rev.omzet / rev.paidCount : 0,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal menganalisis pesanan');
  }
}

export async function detectSalesAnomaly(
  ctx: AgentContext,
  args: { period?: string }
): Promise<ToolResult> {
  try {
    const period = typeof args.period === 'string' ? args.period : '7d';
    const win = periodWindow(period);
    const [current, previous] = await Promise.all([
      fetchOrders(ctx.supabase, { from: win.from, limit: 500 }),
      fetchOrders(ctx.supabase, { ...prevWindow(win.from), limit: 500 }),
    ]);
    const rev = aggregateRevenue(current);
    const prev = aggregateRevenue(previous);
    const daily = dailyRevenueSeries(current, win.days);
    const avgDaily = rev.omzet / win.days;

    const observations: string[] = [];
    if (prev.omzet > 0) {
      const change = ((rev.omzet - prev.omzet) / prev.omzet) * 100;
      if (change <= -20) {
        observations.push(
          `Omzet ${win.label} turun ${Math.abs(change).toFixed(1)}% dibanding periode sebelumnya (Rp ${prev.omzet.toLocaleString('id-ID')} → Rp ${rev.omzet.toLocaleString('id-ID')}).`
        );
      } else if (change >= 20) {
        observations.push(
          `Omzet ${win.label} naik ${change.toFixed(1)}% dibanding periode sebelumnya (Rp ${prev.omzet.toLocaleString('id-ID')} → Rp ${rev.omzet.toLocaleString('id-ID')}).`
        );
      } else {
        observations.push(
          `Omzet ${win.label} relatif stabil (±${Math.abs(change).toFixed(1)}%) dibanding periode sebelumnya.`
        );
      }
    } else {
      observations.push(
        `Tidak ada omzet pada periode pembanding — tidak bisa menghitung perubahan.`
      );
    }

    const outliers = daily.filter((d) => d.revenue > 0 && d.revenue > avgDaily * 2.5);
    if (outliers.length) {
      observations.push(
        `Terdapat ${outliers.length} hari dengan omzet jauh di atas rata-rata: ${outliers
          .map((d) => `${d.date} (Rp ${d.revenue.toLocaleString('id-ID')})`)
          .join(', ')}.`
      );
    }
    const zeroDays = daily.filter((d) => d.revenue === 0).length;
    if (zeroDays > Math.floor(win.days / 2)) {
      observations.push(
        `${zeroDays} dari ${win.days} hari tidak memiliki omzet — penjualan sangat tidak merata.`
      );
    }

    // Product-level change (best/worst movers between the two windows).
    const topNow = topProductsFromOrders(current, 10);
    const topPrev = new Map(topProductsFromOrders(previous, 10).map((p) => [p.id, p.quantitySold]));

    return ok({
      period: win.label,
      omzet: rev.omzet,
      previousOmzet: prev.omzet,
      orderCount: rev.orderCount,
      previousOrderCount: prev.orderCount,
      changePercent:
        prev.omzet > 0 ? ((rev.omzet - prev.omzet) / prev.omzet) * 100 : null,
      avgDailyOmzet: avgDaily,
      observations,
      topProducts: topNow.map((p) => ({
        ...p,
        previousQuantitySold: topPrev.get(p.id) ?? 0,
      })),
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal mendeteksi anomali penjualan');
  }
}

export async function detectLowStock(ctx: AgentContext): Promise<ToolResult> {
  try {
    const products = await fetchProducts(ctx.supabase, { includeInactive: true, limit: 300 });
    const low = products
      .filter((p) => num(p.stock) <= num(p.low_stock_threshold))
      .sort((a, b) => num(a.stock) - num(b.stock))
      .map((p) => {
        const threshold = num(p.low_stock_threshold);
        const stock = num(p.stock);
        const need = stock <= 0 ? Math.max(threshold, 10) : Math.max(threshold - stock + 1, 1);
        return {
          id: p.id,
          name: p.name,
          stock,
          reservedStock: num(p.reserved_stock),
          lowStockThreshold: threshold,
          status: stock <= 0 ? 'habis' : 'menipis',
          recommendedRestockQty: need,
          urgency: stock <= 0 ? 'kritis' : stock <= Math.ceil(threshold / 2) ? 'tinggi' : 'sedang',
        };
      });
    return ok({
      count: low.length,
      outOfStock: low.filter((l) => l.status === 'habis').length,
      lowStock: low.filter((l) => l.status === 'menipis').length,
      products: low.slice(0, 30),
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal mendeteksi stok menipis');
  }
}

export async function generateBusinessSummary(ctx: AgentContext): Promise<ToolResult> {
  try {
    const [orders, products, categories, customers] = await Promise.all([
      fetchOrders(ctx.supabase, { limit: 500 }),
      fetchProducts(ctx.supabase, { includeInactive: true, limit: 300 }),
      fetchCategories(ctx.supabase, 100),
      fetchOrders(ctx.supabase, { limit: 500 }),
    ]);
    const rev = aggregateRevenue(orders);
    const status = statusDistribution(orders);
    const payment = paymentDistribution(orders);
    const out = products.filter((p) => num(p.stock) <= 0).length;
    const low = products.filter(
      (p) => num(p.stock) > 0 && num(p.stock) <= num(p.low_stock_threshold)
    ).length;
    const unpaid = orders.filter((o) => o.payment_status !== 'paid' && o.payment_status !== 'refunded');
    const topProducts = topProductsFromOrders(orders, 5);
    return ok({
      generatedAt: new Date().toISOString(),
      catalog: {
        totalProducts: products.length,
        activeProducts: products.filter((p) => p.is_active).length,
        totalCategories: categories.length,
      },
      orders: {
        totalOrders: orders.length,
        ordersByStatus: status,
        paymentsByStatus: payment,
      },
      revenue: {
        omzet: rev.omzet,
        paidOrders: rev.paidCount,
        avgOrderValue: rev.paidCount > 0 ? rev.omzet / rev.paidCount : 0,
      },
      customers: { totalCustomers: customers.length },
      inventory: {
        outOfStockCount: out,
        lowStockCount: low,
      },
      unpaidOrders: unpaid.length,
      topProducts,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal membuat ringkasan bisnis');
  }
}

export async function generateBusinessRecommendations(ctx: AgentContext): Promise<ToolResult> {
  try {
    const [orders, products, categories] = await Promise.all([
      fetchOrders(ctx.supabase, { limit: 500 }),
      fetchProducts(ctx.supabase, { includeInactive: true, limit: 300 }),
      fetchCategories(ctx.supabase, 100),
    ]);
    const rev = aggregateRevenue(orders);
    const recommendations: string[] = [];

    // Restock.
    const low = products.filter((p) => num(p.stock) <= num(p.low_stock_threshold));
    if (low.length) {
      const out = low.filter((p) => num(p.stock) <= 0);
      recommendations.push(
        `${out.length ? `${out.length} produk habis dan ${low.length - out.length} produk menipis. ` : `${low.length} produk menipis. `}` +
          'Segera restock produk yang habis agar tidak kehilangan penjualan (dapat dilakukan via halaman Stok).'
      );
    } else {
      recommendations.push('Stok produk dalam kondisi aman — tidak ada produk yang perlu restock segera.');
    }

    // Unpaid follow-up.
    const unpaid = orders.filter((o) => o.payment_status !== 'paid' && o.payment_status !== 'refunded');
    if (unpaid.length) {
      const unpaidValue = unpaid.reduce((s, o) => s + num(o.total), 0);
      recommendations.push(
        `Terdapat ${unpaid.length} pesanan belum lunas (nilai total Rp ${unpaidValue.toLocaleString('id-ID')}). Pertimbangkan follow-up reminder pembayaran.`
      );
    }

    // Best sellers → featured/restock.
    const top = topProductsFromOrders(orders, 3);
    if (top.length) {
      recommendations.push(
        `Produk terlaris: ${top.map((p) => `${p.name} (${p.quantitySold} unit)`).join(', ')}. Pastikan stok produk ini selalu tersedia.`
      );
    }

    // Category with most products could be promoted.
    if (categories.length) {
      recommendations.push(
        'Tinjau kategori dengan produk aktif terbanyak untuk promo bundling guna mendorong penjualan silang.'
      );
    }

    return ok({
      basedOn: {
        omzet: rev.omzet,
        totalOrders: orders.length,
        totalProducts: products.length,
      },
      recommendations,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal membuat rekomendasi');
  }
}

export const analysisHandlers: Record<
  string,
  (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolResult>
> = {
  analyze_sales: analyzeSales,
  analyze_revenue: analyzeRevenue,
  analyze_inventory: analyzeInventory,
  analyze_orders: analyzeOrders,
  detect_sales_anomaly: detectSalesAnomaly,
  detect_low_stock: detectLowStock,
  generate_business_summary: generateBusinessSummary,
  generate_business_recommendations: generateBusinessRecommendations,
};
