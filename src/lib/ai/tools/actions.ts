/**
 * ACTION tools — the ONLY write surface of the AI Agent.
 *
 * Deliberately minimal (per master prompt + approval corrections):
 *   * update_order_status      → forward statuses ONLY (processing/shipped/
 *                                delivered). NO cancelled, NO payment_status,
 *                                NO total, NO delete.
 *   * update_product           → non-financial flags only (is_active,
 *                                is_popular, featured, badge). NO price, NO
 *                                stock, NO name/slug.
 *   * update_marketing_content → display fields only. NO type change.
 *
 * NOT exposed (intentionally): cancel_order, adjust_stock, payment status,
 * refund, total changes, order/product deletion, user roles, arbitrary SQL.
 *
 * Every action has an async PREFLIGHT that runs BEFORE confirmation: it
 * resolves admin-friendly references (order number / product name) to the
 * canonical UUID, verifies existence/state, and returns the normalized
 * parameters the confirmation will be bound to. The handler re-runs the same
 * preflight right before the write (defense in depth). Writes run through the
 * signed-in user's own session, so the existing admin RLS policies are the
 * enforcement layer.
 */

import type { AgentContext, ToolResult } from '../types';
import { findOrderByReference, findProductByReference, isUuid, num } from './db';

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const err = (message: string): ToolResult => ({ ok: false, error: message });

const ORDER_FORWARD_STATUSES = ['processing', 'shipped', 'delivered'];
const PRODUCT_FLAG_FIELDS = ['is_active', 'is_popular', 'featured'] as const;
const PRODUCT_BADGES = ['sale', 'hot', 'new'];

export interface PreflightResult {
  /** When set, the action is rejected with this message (no confirmation). */
  error?: string;
  /** Normalized parameters the confirmation is bound to (resolved UUIDs). */
  params?: Record<string, unknown>;
  /** Human-readable target for the confirmation dialog. */
  target?: string;
}

export type ActionPreflight = (
  ctx: AgentContext,
  args: Record<string, unknown>
) => Promise<PreflightResult>;

// ---------------------------------------------------------------------------
// Preflights (no writes) — run before confirmation is requested AND again
// right before the write.
// ---------------------------------------------------------------------------

export async function preflightUpdateOrderStatus(
  ctx: AgentContext,
  args: Record<string, unknown>
): Promise<PreflightResult> {
  if (typeof args.order_id !== 'string' || !args.order_id.trim()) {
    return { error: 'order_id wajib diisi (UUID atau nomor order).' };
  }
  if (typeof args.status !== 'string' || !ORDER_FORWARD_STATUSES.includes(args.status)) {
    return { error: 'Status harus salah satu dari: processing, shipped, delivered.' };
  }
  let found;
  try {
    found = await findOrderByReference(ctx.supabase, args.order_id.trim());
  } catch {
    return { error: 'Gagal mencari pesanan — silakan coba lagi.' };
  }
  if (found.ambiguous) {
    return { error: 'Nomor order ambigu (cocok dengan beberapa pesanan). Sebutkan nomor order lengkap.' };
  }
  if (!found.order) {
    return { error: 'Pesanan tidak ditemukan.' };
  }
  if (found.order.status === 'cancelled') {
    return { error: 'Pesanan sudah dibatalkan — tidak dapat mengubah status.' };
  }
  if (found.order.status === args.status) {
    return { error: `Status pesanan sudah "${args.status}".` };
  }
  return {
    params: { order_id: found.order.id, status: args.status },
    target: `Pesanan ${found.order.order_number ?? found.order.id.slice(0, 8).toUpperCase()}`,
  };
}

export async function preflightUpdateProduct(
  ctx: AgentContext,
  args: Record<string, unknown>
): Promise<PreflightResult> {
  if (typeof args.product_id !== 'string' || !args.product_id.trim()) {
    return { error: 'product_id wajib diisi (UUID atau nama produk).' };
  }
  for (const field of PRODUCT_FLAG_FIELDS) {
    if (args[field] !== undefined && typeof args[field] !== 'boolean') {
      return { error: `Field "${field}" harus bertipe boolean.` };
    }
  }
  if (args.badge !== undefined && args.badge !== null && !PRODUCT_BADGES.includes(args.badge as string)) {
    return { error: 'Badge harus salah satu dari: sale, hot, new, atau null.' };
  }
  const hasAny =
    PRODUCT_FLAG_FIELDS.some((f) => args[f] !== undefined) || args.badge !== undefined;
  if (!hasAny) return { error: 'Tidak ada field yang valid untuk diubah.' };

  let found;
  try {
    found = await findProductByReference(ctx.supabase, args.product_id.trim());
  } catch {
    return { error: 'Gagal mencari produk — silakan coba lagi.' };
  }
  if (found.ambiguous) {
    return { error: 'Nama produk ambigu (cocok dengan beberapa produk). Sebutkan nama lengkap produk.' };
  }
  if (!found.product) {
    return { error: 'Produk tidak ditemukan.' };
  }
  const patch: Record<string, unknown> = {};
  for (const field of PRODUCT_FLAG_FIELDS) {
    if (args[field] !== undefined) patch[field] = args[field];
  }
  if (args.badge !== undefined) patch.badge = args.badge;
  return {
    params: { product_id: found.product.id, ...patch },
    target: `Produk ${found.product.name}`,
  };
}

export async function preflightUpdateMarketingContent(
  ctx: AgentContext,
  args: Record<string, unknown>
): Promise<PreflightResult> {
  if (!isUuid(args.id)) return { error: 'id konten tidak valid (harus UUID).' };
  const textFields = ['badge', 'title', 'subtitle', 'description', 'cta_text', 'cta_url'];
  for (const field of textFields) {
    if (args[field] !== undefined && args[field] !== null && typeof args[field] !== 'string') {
      return { error: `Field "${field}" harus bertipe string.` };
    }
  }
  if (args.sort_order !== undefined) {
    if (typeof args.sort_order !== 'number' || !Number.isInteger(args.sort_order)) {
      return { error: 'sort_order harus bilangan bulat.' };
    }
  }
  if (args.is_active !== undefined && typeof args.is_active !== 'boolean') {
    return { error: 'is_active harus bertipe boolean.' };
  }
  const hasAny =
    textFields.some((f) => args[f] !== undefined) ||
    args.sort_order !== undefined ||
    args.is_active !== undefined;
  if (!hasAny) return { error: 'Tidak ada field yang valid untuk diubah.' };

  try {
    const { data: existing } = await ctx.supabase
      .from('marketing_content')
      .select('id, type, title')
      .eq('id', args.id)
      .maybeSingle();
    if (!existing) return { error: 'Konten marketing tidak ditemukan.' };
    const patch: Record<string, unknown> = {};
    for (const field of textFields) {
      if (args[field] !== undefined) patch[field] = args[field];
    }
    if (args.sort_order !== undefined) patch.sort_order = args.sort_order;
    if (args.is_active !== undefined) patch.is_active = args.is_active;
    const title = typeof existing.title === 'string' && existing.title ? existing.title : existing.type;
    return {
      params: { id: existing.id, ...patch },
      target: `Konten ${existing.type} "${title}"`,
    };
  } catch {
    return { error: 'Gagal mencari konten marketing.' };
  }
}

// ---------------------------------------------------------------------------
// Handlers — full preflight again right before the write.
// ---------------------------------------------------------------------------

export async function updateOrderStatus(
  ctx: AgentContext,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const pre = await preflightUpdateOrderStatus(ctx, args);
  if (pre.error) return err(pre.error);
  const orderId = (pre.params as Record<string, unknown>).order_id as string;
  const status = (pre.params as Record<string, unknown>).status as string;
  try {
    const order = await findOrderByReference(ctx.supabase, orderId);
    if (!order.order) return err('Pesanan tidak ditemukan.');

    // Mirrors the existing admin `updateOrderStatus` service for non-cancelled
    // statuses: a plain status UPDATE (admin RLS policy allows it). payment_status
    // and total are never touched.
    const { error } = await ctx.supabase
      .from('orders')
      .update({ status })
      .eq('id', orderId)
      .select('id, order_number, status');
    if (error) {
      if (error.message.includes('permission denied')) {
        return err('Anda tidak memiliki izin untuk mengubah status pesanan.');
      }
      return err(error.message);
    }
    return ok({
      orderId,
      orderNumber: order.order.order_number ?? order.order.id.slice(0, 8).toUpperCase(),
      previousStatus: order.order.status,
      newStatus: status,
      paymentStatus: order.order.payment_status, // untouched — informational
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal mengubah status pesanan');
  }
}

export async function updateProduct(
  ctx: AgentContext,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const pre = await preflightUpdateProduct(ctx, args);
  if (pre.error) return err(pre.error);
  const params = pre.params as Record<string, unknown>;
  const productId = params.product_id as string;
  const patch: Record<string, unknown> = {};
  for (const field of PRODUCT_FLAG_FIELDS) {
    if (params[field] !== undefined) patch[field] = params[field];
  }
  if (params.badge !== undefined) patch.badge = params.badge;

  try {
    const product = await findProductByReference(ctx.supabase, productId);
    if (!product.product) return err('Produk tidak ditemukan.');

    const { error } = await ctx.supabase
      .from('products')
      .update(patch)
      .eq('id', productId)
      .select('id, name, price, stock, is_active, is_popular, featured, badge');
    if (error) {
      if (error.message.includes('permission denied')) {
        return err('Anda tidak memiliki izin untuk mengubah produk.');
      }
      return err(error.message);
    }
    return ok({
      productId,
      name: product.product.name,
      price: num(product.product.price), // untouched — informational
      stock: num(product.product.stock), // untouched — informational
      changes: patch,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal mengubah produk');
  }
}

export async function updateMarketingContent(
  ctx: AgentContext,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const pre = await preflightUpdateMarketingContent(ctx, args);
  if (pre.error) return err(pre.error);
  const params = pre.params as Record<string, unknown>;
  const id = params.id as string;
  const patch: Record<string, unknown> = { ...params };
  delete patch.id;

  try {
    const { error } = await ctx.supabase
      .from('marketing_content')
      .update(patch)
      .eq('id', id)
      .select('id, type, title, is_active, sort_order');
    if (error) {
      if (error.message.includes('permission denied')) {
        return err('Anda tidak memiliki izin untuk mengubah konten marketing.');
      }
      return err(error.message);
    }
    return ok({ id, changes: patch });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Gagal mengubah konten marketing');
  }
}

export const actionHandlers: Record<
  string,
  (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolResult>
> = {
  update_order_status: updateOrderStatus,
  update_product: updateProduct,
  update_marketing_content: updateMarketingContent,
};

/** Preflight map used by the agent core before asking for confirmation. */
export const actionPreflights: Record<string, ActionPreflight> = {
  update_order_status: preflightUpdateOrderStatus,
  update_product: preflightUpdateProduct,
  update_marketing_content: preflightUpdateMarketingContent,
};
