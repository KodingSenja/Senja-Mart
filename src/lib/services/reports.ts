import type { OrderStatus, PaymentStatus } from 'types/order';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

/**
 * Laporan Penjualan — READ-ONLY aggregation of REAL Supabase data.
 *
 * Sources (tables the admin already reads via RLS):
 *   * orders + order_items  → omzet, counts, daily series, terlaris, transaksi
 *   * products + categories → mapping product → kategori (for kategori terlaris)
 *
 * No DB change, no RPC, no writes: everything is aggregated client-side from
 * the same tables the admin pages already read.
 *
 * Omzet rule (business logic):
 *   omzet = SUM(total) of orders where payment_status = 'paid' AND status != 'cancelled'.
 *   Unpaid / refunded / cancelled orders are NEVER counted as omzet.
 *   Produk & kategori terlaris are derived from those same valid paid orders
 *   via their real order_items (product_name snapshot + price + quantity).
 */

// ---------------------------------------------------------------------------
// Period helpers (Asia/Jakarta, same convention as dashboard.ts)
// ---------------------------------------------------------------------------

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7 (WIB)
const DAY_MS = 24 * 60 * 60 * 1000;

/** Current time shifted into Asia/Jakarta wall-clock space. */
function jakartaNow(): Date {
  return new Date(Date.now() + JAKARTA_OFFSET_MS);
}

/** yyyy-mm-dd calendar date (Jakarta) of an ISO timestamp. */
export function jakartaDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + JAKARTA_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** Start (UTC ISO) of the Jakarta day containing the given Jakarta-shifted Date. */
function startOfDayUTC(jakartaDate: Date): string {
  return new Date(
    Date.UTC(
      jakartaDate.getUTCFullYear(),
      jakartaDate.getUTCMonth(),
      jakartaDate.getUTCDate()
    ) - JAKARTA_OFFSET_MS
  ).toISOString();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export type ReportPeriodKey =
  | 'today'
  | '7d'
  | '30d'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom'
  | 'monthYear';

export interface ReportPeriod {
  key: ReportPeriodKey;
  /** Human label shown in UI/PDF, e.g. "Agustus 2026" or "13–14 Agustus 2026". */
  label: string;
  startISO: string; // inclusive
  endISO: string; // exclusive
  prevStartISO: string;
  prevEndISO: string;
}

const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

function fmtRange(startDate: Date, endDate: Date): string {
  const s = startDate;
  const e = addDays(endDate, -1); // endISO is exclusive → last day
  const sameDay = jakartaDateKey(s.toISOString()) === jakartaDateKey(e.toISOString());
  const sameMonth = s.getUTCMonth() === e.getUTCMonth();
  const fmtDay = (d: Date) => `${d.getUTCDate()} ${MONTHS_ID[d.getUTCMonth()]}`;
  if (sameDay) return `${fmtDay(s)} ${s.getUTCFullYear()}`;
  if (sameMonth) return `${s.getUTCDate()}–${fmtDay(e)} ${e.getUTCFullYear()}`;
  return `${s.getUTCDate()} ${MONTHS_ID[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS_ID[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
}

/**
 * Resolve a period selection into a concrete [start, end) window + previous
 * window (same duration, immediately before). All times are Asia/Jakarta.
 */
export function resolvePeriod(
  key: ReportPeriodKey,
  opts: { customFrom?: string; customTo?: string; monthYear?: string } = {}
): ReportPeriod {
  const jn = jakartaNow();
  // "Now" as a real UTC instant (jakartaNow is only used for calendar math).
  const now = new Date();

  let start: Date;
  let end: Date;
  let label: string;

  switch (key) {
    case 'today': {
      start = new Date(startOfDayUTC(jn));
      end = now;
      label = `Hari Ini · ${fmtRange(start, end)}`;
      break;
    }
    case '7d': {
      start = addDays(new Date(startOfDayUTC(jn)), -6);
      end = now;
      label = `7 Hari · ${fmtRange(start, end)}`;
      break;
    }
    case '30d': {
      start = addDays(new Date(startOfDayUTC(jn)), -29);
      end = now;
      label = `30 Hari · ${fmtRange(start, end)}`;
      break;
    }
    case 'thisMonth': {
      start = new Date(
        Date.UTC(jn.getUTCFullYear(), jn.getUTCMonth(), 1) - JAKARTA_OFFSET_MS
      );
      end = now;
      label = `${MONTHS_ID[jn.getUTCMonth()]} ${jn.getUTCFullYear()}`;
      break;
    }
    case 'lastMonth': {
      const firstThis = new Date(
        Date.UTC(jn.getUTCFullYear(), jn.getUTCMonth(), 1) - JAKARTA_OFFSET_MS
      );
      const firstPrev = new Date(
        Date.UTC(jn.getUTCFullYear(), jn.getUTCMonth() - 1, 1) - JAKARTA_OFFSET_MS
      );
      start = firstPrev;
      end = firstThis;
      label = `${MONTHS_ID[firstPrev.getUTCMonth()]} ${firstPrev.getUTCFullYear()}`;
      break;
    }
    case 'custom': {
      const from = opts.customFrom || startOfDayUTC(jn).slice(0, 10);
      const to = opts.customTo || from;
      start = new Date(
        Date.UTC(
          Number(from.slice(0, 4)),
          Number(from.slice(5, 7)) - 1,
          Number(from.slice(8, 10))
        ) - JAKARTA_OFFSET_MS
      );
      const toDate = new Date(
        Date.UTC(
          Number(to.slice(0, 4)),
          Number(to.slice(5, 7)) - 1,
          Number(to.slice(8, 10))
        )
      );
      end = addDays(new Date(toDate.getTime() - JAKARTA_OFFSET_MS), 1);
      label = `Custom · ${fmtRange(start, end)}`;
      break;
    }
    case 'monthYear': {
      const ym = opts.monthYear || `${jn.getUTCFullYear()}-${String(jn.getUTCMonth() + 1).padStart(2, '0')}`;
      const y = Number(ym.slice(0, 4));
      const m = Number(ym.slice(5, 7)) - 1;
      start = new Date(Date.UTC(y, m, 1) - JAKARTA_OFFSET_MS);
      end = new Date(Date.UTC(y, m + 1, 1) - JAKARTA_OFFSET_MS);
      label = `${MONTHS_ID[m]} ${y}`;
      break;
    }
  }

  const durationMs = end.getTime() - start.getTime();
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - durationMs);

  return {
    key,
    label,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    prevStartISO: prevStart.toISOString(),
    prevEndISO: prevEnd.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Aggregation types
// ---------------------------------------------------------------------------

export interface ReportSummary {
  totalOmzet: number;
  totalOrders: number;
  paidOrders: number;
  unpaidOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  avgOrderValue: number;
}

export interface DailyRevenue {
  /** yyyy-mm-dd (Jakarta) — for weekly buckets this is the bucket's first day. */
  date: string;
  revenue: number;
}

export interface TopItem {
  id: string;
  name: string;
  quantitySold: number;
  revenue: number;
}

export interface ReportTransaction {
  id: string;
  orderNumber: string;
  customer: string | null;
  date: string;
  total: number;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
}

export interface ReportComparison {
  hasPrev: boolean;
  prevTotalOmzet: number;
  prevTotalOrders: number;
  /** null when there's no previous data to compare against. */
  omzetChangePercent: number | null;
}

export interface ReportData {
  summary: ReportSummary;
  daily: DailyRevenue[];
  topProducts: TopItem[];
  topCategories: TopItem[];
  transactions: ReportTransaction[];
  comparison: ReportComparison | null;
}

// ---------------------------------------------------------------------------
// Raw row shapes
// ---------------------------------------------------------------------------

interface OrderItemRow {
  product_id: string | null;
  product_name: string;
  price: number | string;
  quantity: number;
}

interface OrderRow {
  id: string;
  order_number: string | null;
  status: string;
  payment_status: string;
  total: number | string;
  created_at: string;
  shipping_address: Record<string, unknown> | null;
  order_items?: OrderItemRow[] | null;
}

interface LightOrderRow {
  id: string;
  status: string;
  payment_status: string;
  total: number | string;
}

interface ProductRow {
  id: string;
  category_id: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
}

/** Empty (no fake numbers) report used when Supabase isn't configured. */
function emptyReport(): ReportData {
  return {
    summary: {
      totalOmzet: 0,
      totalOrders: 0,
      paidOrders: 0,
      unpaidOrders: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
      avgOrderValue: 0,
    },
    daily: [],
    topProducts: [],
    topCategories: [],
    transactions: [],
    comparison: null,
  };
}

function isPaid(order: { payment_status: string }): boolean {
  return order.payment_status === 'paid';
}

function isCancelled(order: { status: string }): boolean {
  return order.status === 'cancelled';
}

/** Aggregated summary from a list of order rows (light or full). */
function summarize(rows: LightOrderRow[]): {
  omzet: number;
  totalOrders: number;
  paidOrders: number;
  unpaidOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
} {
  let omzet = 0;
  let paid = 0;
  let unpaid = 0;
  let delivered = 0;
  let cancelled = 0;
  for (const o of rows) {
    const total = Number(o.total) || 0;
    if (isCancelled(o)) cancelled += 1;
    if (o.status === 'delivered') delivered += 1;
    if (isPaid(o)) paid += 1;
    else unpaid += 1;
    if (isPaid(o) && !isCancelled(o)) omzet += total;
  }
  return {
    omzet,
    totalOrders: rows.length,
    paidOrders: paid,
    unpaidOrders: unpaid,
    deliveredOrders: delivered,
    cancelledOrders: cancelled,
  };
}

/**
 * Build a zero-filled daily (or weekly for long ranges) revenue series.
 * Keeps the chart readable for custom ranges spanning months.
 */
function buildDailySeries(
  startISO: string,
  endISO: string,
  byDay: Map<string, number>
): DailyRevenue[] {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const days: DailyRevenue[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) {
    const key = jakartaDateKey(d.toISOString());
    days.push({ date: key, revenue: byDay.get(key) ?? 0 });
  }

  const MAX_POINTS = 62;
  if (days.length <= MAX_POINTS) return days;

  // Weekly buckets for very long ranges.
  const buckets: DailyRevenue[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    buckets.push({
      date: chunk[0].date,
      revenue: chunk.reduce((s, p) => s + p.revenue, 0),
    });
  }
  return buckets;
}

/**
 * Load + aggregate the sales report for a resolved period.
 * Throws when a query fails (page shows an error instead of fake data).
 */
export async function getReportData(
  period: ReportPeriod
): Promise<ReportData> {
  if (!isSupabaseConfigured || !supabase) return emptyReport();

  const [
    { data: current, error: currentError },
    { data: previous, error: previousError },
    { data: products, error: productsError },
    { data: categories, error: categoriesError },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('*, order_items(product_id, product_name, price, quantity)')
      .gte('created_at', period.startISO)
      .lt('created_at', period.endISO)
      .order('created_at', { ascending: false }),
    supabase
      .from('orders')
      .select('id, status, payment_status, total')
      .gte('created_at', period.prevStartISO)
      .lt('created_at', period.prevEndISO),
    supabase.from('products').select('id, category_id'),
    supabase.from('categories').select('id, name'),
  ]);

  if (currentError) throw new Error(currentError.message);
  if (previousError) throw new Error(previousError.message);
  if (productsError) throw new Error(productsError.message);
  if (categoriesError) throw new Error(categoriesError.message);

  const rows = (current ?? []) as OrderRow[];
  const prevRows = (previous ?? []) as LightOrderRow[];
  const productRows = (products ?? []) as ProductRow[];
  const categoryRows = (categories ?? []) as CategoryRow[];

  const summary = summarize(rows);
  const prevSummary = summarize(prevRows);

  // product_id → category name (real mapping; unknown → "Tanpa Kategori").
  const categoryById = new Map(categoryRows.map((c) => [c.id, c.name]));
  const categoryOfProduct = new Map<string, string>();
  for (const p of productRows) {
    categoryOfProduct.set(
      p.id,
      p.category_id ? categoryById.get(p.category_id) ?? 'Tanpa Kategori' : 'Tanpa Kategori'
    );
  }

  // ---- Daily series (only valid paid omzet) ----
  const byDay = new Map<string, number>();
  for (const o of rows) {
    if (!isPaid(o) || isCancelled(o)) continue;
    const key = jakartaDateKey(o.created_at);
    byDay.set(key, (byDay.get(key) ?? 0) + (Number(o.total) || 0));
  }
  const daily = buildDailySeries(period.startISO, period.endISO, byDay);

  // ---- Top products & categories (from valid paid orders' real items) ----
  const productAgg = new Map<
    string,
    { name: string; quantitySold: number; revenue: number; category: string }
  >();
  for (const o of rows) {
    if (!isPaid(o) || isCancelled(o)) continue;
    for (const item of o.order_items ?? []) {
      const pid = item.product_id ?? `snapshot:${item.product_name}`;
      const price = Number(item.price) || 0;
      const qty = item.quantity || 0;
      const agg = productAgg.get(pid) ?? {
        name: item.product_name || 'Produk',
        quantitySold: 0,
        revenue: 0,
        category: pid.startsWith('snapshot:')
          ? 'Tanpa Kategori'
          : categoryOfProduct.get(pid) ?? 'Tanpa Kategori',
      };
      agg.quantitySold += qty;
      agg.revenue += price * qty;
      productAgg.set(pid, agg);
    }
  }

  const topProducts: TopItem[] = [...productAgg.entries()]
    .map(([id, v]) => ({
      id,
      name: v.name,
      quantitySold: v.quantitySold,
      revenue: v.revenue,
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
    .slice(0, 10);

  const categoryAgg = new Map<string, { quantitySold: number; revenue: number }>();
  for (const [, v] of productAgg) {
    const agg = categoryAgg.get(v.category) ?? { quantitySold: 0, revenue: 0 };
    agg.quantitySold += v.quantitySold;
    agg.revenue += v.revenue;
    categoryAgg.set(v.category, agg);
  }

  const topCategories: TopItem[] = [...categoryAgg.entries()]
    .map(([name, v]) => ({
      id: name,
      name,
      quantitySold: v.quantitySold,
      revenue: v.revenue,
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
    .slice(0, 5);

  // ---- Detail transaksi (all orders in period, newest first) ----
  const transactions: ReportTransaction[] = rows.map((o) => ({
    id: o.id,
    orderNumber: o.order_number ?? o.id.slice(0, 8).toUpperCase(),
    customer:
      (o.shipping_address?.name as string | undefined) ?? null,
    date: o.created_at,
    total: Number(o.total) || 0,
    paymentStatus: (o.payment_status as PaymentStatus) ?? 'unpaid',
    status: (o.status as OrderStatus) ?? 'pending',
  }));

  // ---- Comparison vs previous period ----
  const hasPrev = prevSummary.totalOrders > 0;
  const comparison: ReportComparison | null = hasPrev
    ? {
        hasPrev,
        prevTotalOmzet: prevSummary.omzet,
        prevTotalOrders: prevSummary.totalOrders,
        omzetChangePercent:
          prevSummary.omzet > 0
            ? ((summary.omzet - prevSummary.omzet) / prevSummary.omzet) * 100
            : summary.omzet > 0
              ? null
              : 0,
      }
    : null;

  return {
    summary: {
      totalOmzet: summary.omzet,
      totalOrders: summary.totalOrders,
      paidOrders: summary.paidOrders,
      unpaidOrders: summary.unpaidOrders,
      deliveredOrders: summary.deliveredOrders,
      cancelledOrders: summary.cancelledOrders,
      avgOrderValue:
        summary.paidOrders > 0 ? summary.omzet / summary.paidOrders : 0,
    },
    daily,
    topProducts,
    topCategories,
    transactions,
    comparison,
  };
}
