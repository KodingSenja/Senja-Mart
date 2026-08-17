import { createHash } from 'node:crypto';

/**
 * Server-only Midtrans helpers (Snap Sandbox / Production).
 *
 * IMPORTANT: this module must NEVER be imported from a client component —
 * it reads MIDTRANS_SERVER_KEY which must stay server-side only.
 */

/**
 * Max length of `item_details[].name` accepted by the Midtrans Snap API
 * (see docs: JSON Objects → Item Details Object → name: String(50)).
 * Names longer than this are rejected with "item_details Name is too long".
 */
export const MIDTRANS_ITEM_NAME_MAX_LENGTH = 50;

/**
 * Truncate an item name so the Midtrans payload satisfies the 50-char
 * limit. Operates on code points so multi-byte characters (e.g. emoji)
 * are never split. The source product name is left untouched.
 */
export function sanitizeMidtransItemName(name: string): string {
  const chars = Array.from(name);
  return chars.length > MIDTRANS_ITEM_NAME_MAX_LENGTH
    ? chars.slice(0, MIDTRANS_ITEM_NAME_MAX_LENGTH).join('')
    : name;
}

export const midtransConfig = {
  serverKey: process.env.MIDTRANS_SERVER_KEY ?? '',
  clientKey: process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? '',
  /** Sandbox by default. Flip to true for production (app.midtrans.com). */
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
};

export const isMidtransConfigured = Boolean(
  midtransConfig.serverKey && midtransConfig.clientKey
);

/** Snap script URL for the browser (returned by the transaction endpoint). */
export function snapScriptUrl(): string {
  return midtransConfig.isProduction
    ? 'https://app.midtrans.com/snap/snap.js'
    : 'https://app.sandbox.midtrans.com/snap/snap.js';
}

function baseUrls() {
  return midtransConfig.isProduction
    ? { snap: 'https://app.midtrans.com', api: 'https://api.midtrans.com' }
    : { snap: 'https://app.sandbox.midtrans.com', api: 'https://api.sandbox.midtrans.com' };
}

function authHeader() {
  return `Basic ${Buffer.from(`${midtransConfig.serverKey}:`).toString('base64')}`;
}

export interface MidtransItem {
  id: string;
  price: number;
  quantity: number;
  name: string;
}

export interface SnapCustomer {
  first_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  postal_code?: string;
}

export interface CreateSnapParams {
  orderId: string;
  grossAmount: number;
  items: MidtransItem[];
  customer?: SnapCustomer;
}

/** Create a Snap transaction and return its token. Amount comes from the server. */
export async function createSnapTransaction(params: CreateSnapParams) {
  const { snap } = baseUrls();
  const body = {
    transaction_details: {
      order_id: params.orderId,
      gross_amount: params.grossAmount,
    },
    // item_details.name is limited to 50 chars by Midtrans — truncate
    // product names at the payload boundary (source name stays untouched).
    item_details: params.items.map((item) => ({
      ...item,
      name: sanitizeMidtransItemName(item.name),
    })),
    customer_details: params.customer,
    credit_card: { secure: true },
  };

  const res = await fetch(`${snap}/snap/v1/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const message =
      (Array.isArray(json.error_messages) && json.error_messages[0]) ||
      json.status_message ||
      `Midtrans error (${json.status_code ?? res.status})`;
    throw new Error(String(message));
  }

  return {
    token: String(json.token ?? ''),
    redirectUrl: json.redirect_url ? String(json.redirect_url) : null,
  };
}

/** Fetch the latest Midtrans status for an order_id (server key). */
export async function getTransactionStatus(orderId: string) {
  const { api } = baseUrls();
  const res = await fetch(`${api}/v2/${encodeURIComponent(orderId)}/status`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: authHeader() },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      String(json.status_message ?? `Midtrans status error (${res.status})`)
    );
  }
  return json;
}

/**
 * Verify the Midtrans HTTP-notification signature:
 * sha512(order_id + status_code + gross_amount + ServerKey)
 */
export function verifyNotificationSignature(
  payload: Record<string, unknown>,
  serverKey = midtransConfig.serverKey
): boolean {
  const { order_id, status_code, gross_amount, signature_key } = payload;
  if (!order_id || !status_code || gross_amount == null || !signature_key) {
    return false;
  }
  const raw = `${order_id}${status_code}${gross_amount}${serverKey}`;
  const expected = createHash('sha512').update(raw).digest('hex');
  return expected === signature_key;
}

/**
 * Payment statuses stored on orders.payment_status (kept in sync with the
 * DB check constraint — see migration 20260810290000).
 */
export type PaymentStatus =
  | 'unpaid'
  | 'pending'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'refunded';

/**
 * Map a Midtrans transaction_status to orders.payment_status.
 *   settlement / capture -> paid
 *   pending              -> pending
 *   expire               -> expired
 *   cancel / deny        -> failed
 *   anything else        -> unpaid
 */
export function mapMidtransToPaymentStatus(status: string): PaymentStatus {
  switch (status) {
    case 'settlement':
    case 'capture':
      return 'paid';
    case 'pending':
      return 'pending';
    case 'expire':
      return 'expired';
    case 'cancel':
    case 'deny':
      return 'failed';
    default:
      return 'unpaid';
  }
}

/** Statuses whose Snap token can still be reused (avoid duplicate transactions). */
export const ACTIVE_TRANSACTION_STATUSES = ['pending'];

/**
 * Build a unique Midtrans order_id for a payment attempt.
 *
 * Midtrans keeps every order_id it has ever seen, so the same order cannot
 * reuse its UUID as order_id after a previous transaction expired/cancelled
 * ("transaction_details.order_id has already been taken"). Each attempt gets
 * its own id while the orders row stays the same.
 *
 * Format: "<order-uuid>-<timestamp-base36>". The uuid prefix lets any route
 * resolve the order back from a webhook/status payload via
 * orderUuidFromMidtransOrderId(). Max length is well under Midtrans' 50.
 */
export function buildMidtransOrderId(orderId: string): string {
  return `${orderId}-${Date.now().toString(36)}`;
}

const ORDER_UUID_PREFIX_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/**
 * Extract the order UUID from a Midtrans order_id built by
 * buildMidtransOrderId() (also matches legacy ids where the order UUID was
 * used directly). Returns null when the string does not start with a UUID.
 */
export function orderUuidFromMidtransOrderId(
  midtransOrderId: string
): string | null {
  const match = ORDER_UUID_PREFIX_RE.exec(midtransOrderId);
  return match ? match[1] : null;
}
