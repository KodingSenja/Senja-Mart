/**
 * Tool registry — the ONLY tools the model may call. The agent core resolves
 * every tool call through this registry: unknown tools are rejected, inputs
 * are validated, and action tools are gated by the confirmation guard.
 */

import type { AgentContext, ToolResult, ToolSpec } from '../types';
import { toolSchemas } from './schema';
import { readHandlers } from './read';
import { analysisHandlers } from './analysis';
import { actionHandlers } from './actions';

export interface RegisteredTool extends ToolSpec {
  handler: (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

const TOOL_DEFS: Array<{
  name: string;
  description: string;
  type: RegisteredTool['type'];
  handler: RegisteredTool['handler'];
}> = [
  // ------------------------------------------------------------ READ
  {
    name: 'get_dashboard_summary',
    description:
      'Ringkasan LEVEL-AGREGAT (overview): jumlah produk/kategori, jumlah pesanan per status, omzet total, stok menipis/habis, dan 5 pesanan terbaru. TIDAK berisi performa per produk (unit terjual/omzet per produk) — jangan dipakai untuk pertanyaan yang butuh rekomendasi produk spesifik.',
    type: 'read',
    handler: readHandlers.get_dashboard_summary,
  },
  {
    name: 'get_revenue',
    description:
      'Omzet (payment_status=paid dan status!=cancelled) untuk periode: today | 7d | 30d | thisMonth | all, plus perbandingan dengan periode sebelumnya.',
    type: 'read',
    handler: readHandlers.get_revenue,
  },
  {
    name: 'get_orders',
    description:
      'Daftar pesanan dengan filter opsional (status, payment_status, pencarian nomor order/nama customer, limit).',
    type: 'read',
    handler: readHandlers.get_orders,
  },
  {
    name: 'get_order_detail',
    description:
      'Detail satu pesanan lengkap (items, alamat, total, status, pembayaran, transaksi Midtrans bila ada) berdasarkan order_id (UUID).',
    type: 'read',
    handler: readHandlers.get_order_detail,
  },
  {
    name: 'get_products',
    description: 'Daftar produk dengan filter opsional (search, category_id, include_inactive, limit).',
    type: 'read',
    handler: readHandlers.get_products,
  },
  {
    name: 'get_categories',
    description: 'Daftar kategori.',
    type: 'read',
    handler: readHandlers.get_categories,
  },
  {
    name: 'get_inventory',
    description:
      'Data stok produk (stock, reserved, available, low_stock_threshold, status safe/low/out) dengan filter status opsional.',
    type: 'read',
    handler: readHandlers.get_inventory,
  },
  {
    name: 'get_sales_analytics',
    description:
      'Analitik penjualan untuk periode: omzet, jumlah order, series omzet harian, dan produk terlaris.',
    type: 'read',
    handler: readHandlers.get_sales_analytics,
  },
  {
    name: 'get_top_products',
    description: 'Produk terlaris (unit terjual & omzet) untuk periode tertentu.',
    type: 'read',
    handler: readHandlers.get_top_products,
  },
  {
    name: 'get_low_stock_products',
    description: 'Produk dengan stok ≤ low_stock_threshold (termasuk habis), paling kritis dulu.',
    type: 'read',
    handler: readHandlers.get_low_stock_products,
  },
  {
    name: 'get_customer_summary',
    description: 'Ringkasan customer: total akun, jumlah yang pernah order, dan customer dengan omzet terbesar.',
    type: 'read',
    handler: readHandlers.get_customer_summary,
  },
  {
    name: 'get_payment_status',
    description:
      'Status pembayaran: jumlah per payment_status dan daftar pesanan yang belum lunas.',
    type: 'read',
    handler: readHandlers.get_payment_status,
  },
  {
    name: 'get_refund_status',
    description: 'Ringkasan refund: jumlah pesanan berstatus refunded dan daftarnya.',
    type: 'read',
    handler: readHandlers.get_refund_status,
  },

  // ---------------------------------------------------------- ANALYSIS
  {
    name: 'analyze_sales',
    description:
      'Analisis penjualan periode: omzet, tren harian, perbandingan periode sebelumnya, produk & kategori terlaris. Pilih tool ini untuk pertanyaan tentang tren penjualan, performa penjualan, kenaikan/penurunan penjualan, performa produk, atau analisis yang dibutuhkan untuk mendukung strategi penjualan.',
    type: 'analysis',
    handler: analysisHandlers.analyze_sales,
  },
  {
    name: 'analyze_revenue',
    description: 'Analisis omzet: total, rata-rata, perbandingan, hari terbaik, dan distribusi harian.',
    type: 'analysis',
    handler: analysisHandlers.analyze_revenue,
  },
  {
    name: 'analyze_inventory',
    description: 'Analisis inventory: distribusi stok, produk habis/menipis, total unit reserved.',
    type: 'analysis',
    handler: analysisHandlers.analyze_inventory,
  },
  {
    name: 'analyze_orders',
    description: 'Analisis pesanan: distribusi status, distribusi pembayaran, pesanan belum lunas, nilai rata-rata.',
    type: 'analysis',
    handler: analysisHandlers.analyze_orders,
  },
  {
    name: 'detect_sales_anomaly',
    description:
      'Deteksi anomali penjualan: bandingkan periode dengan periode sebelumnya, tandai kenaikan/penurunan signifikan dan hari outlier.',
    type: 'analysis',
    handler: analysisHandlers.detect_sales_anomaly,
  },
  {
    name: 'detect_low_stock',
    description: 'Deteksi produk stok menipis/habis dengan tingkat urgensi dan rekomendasi jumlah restock.',
    type: 'analysis',
    handler: analysisHandlers.detect_low_stock,
  },
  {
    name: 'generate_business_summary',
    description:
      'Ringkasan kondisi bisnis menyeluruh: katalog, pesanan, omzet, customer, inventory, produk terlaris. Gunakan tool ini untuk pertanyaan DIAGNOSIS/penilaian kondisi bisnis ("apa masalah terbesar toko?", "apa yang perlu diperbaiki?", "kenapa penjualan belum maksimal?", "bagaimana kondisi bisnis saya?") sebelum menyusun diagnosis.',
    type: 'analysis',
    handler: analysisHandlers.generate_business_summary,
  },
  {
    name: 'generate_business_recommendations',
    description:
      'Rekomendasi berbasis data aktual SenjaMart: restock, follow-up pembayaran, produk yang layak dipromosikan, dan strategi penjualan. Gunakan tool ini untuk pertanyaan yang MEMINTA rekomendasi/strategi (cara meningkatkan penjualan, cara membuat toko lebih laku, produk yang sebaiknya dipromosikan, peluang menaikkan omzet). JANGAN gunakan tool ini untuk pertanyaan DIAGNOSIS/kondisi bisnis ("apa masalah terbesar?", "apa yang perlu diperbaiki?", "kenapa penjualan belum maksimal?", "bagaimana kondisi bisnis saya?") — untuk itu gunakan generate_business_summary atau tool analisis lain.',
    type: 'analysis',
    handler: analysisHandlers.generate_business_recommendations,
  },

  // ------------------------------------------------------------ ACTION
  {
    name: 'update_order_status',
    description:
      'Ubah status order ke processing | shipped | delivered (bukan cancelled). Tidak menyentuh pembayaran. Membutuhkan konfirmasi.',
    type: 'action',
    handler: actionHandlers.update_order_status,
  },
  {
    name: 'update_product',
    description:
      'Ubah atribut produk non-finansial: is_active, is_popular, featured, badge. Tidak mengubah harga/stok/nama. Membutuhkan konfirmasi.',
    type: 'action',
    handler: actionHandlers.update_product,
  },
  {
    name: 'update_marketing_content',
    description:
      'Ubah konten marketing (hero/banner): is_active, sort_order, badge, title, subtitle, description, cta. Membutuhkan konfirmasi.',
    type: 'action',
    handler: actionHandlers.update_marketing_content,
  },
];

export const toolRegistry: RegisteredTool[] = TOOL_DEFS.map((t) => ({
  ...t,
  parameters: toolSchemas[t.name] ?? { type: 'object', properties: {}, additionalProperties: false },
}));

const byName = new Map(toolRegistry.map((t) => [t.name, t]));

export function getTool(name: string): RegisteredTool | undefined {
  return byName.get(name);
}

/** Tool list the model can see (read + analysis + action). */
export function modelTools(): ToolSpec[] {
  return toolRegistry.map((t) => ({
    name: t.name,
    description: t.description,
    type: t.type,
    parameters: t.parameters,
  }));
}
