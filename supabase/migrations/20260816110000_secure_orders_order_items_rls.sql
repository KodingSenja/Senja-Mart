-- ============================================
-- SENJA MART - SECURE ORDERS & ORDER_ITEMS RLS
-- ============================================
-- Closes the audit finding (HIGH): the customer INSERT policies on
-- `orders` and `order_items` (plus their GRANTs) let an authenticated
-- customer write arbitrary financial rows straight through the Supabase
-- Data API:
--   * orders.payment_status = 'paid'   -> fake "already paid" order
--   * orders.total / subtotal          -> fake total
--   * order_items.price                -> fake unit price
--
-- The official checkout path is 100% RPC-based: Cart -> place_order ->
-- orders/order_items. place_order is SECURITY DEFINER (runs with the
-- function owner's privileges, bypassing RLS), so revoking the Data-API
-- INSERT privileges and dropping the permissive INSERT policies does NOT
-- affect checkout, the Midtrans webhook (service role), or the admin UI.
--
-- What changes:
--   * DROP the two customer INSERT policies (orders, order_items)
--   * REVOKE INSERT from the `authenticated` role on orders & order_items
--
-- What is kept (unchanged):
--   * SELECT policies (customers see their own rows; admins see all)
--   * admin UPDATE policy + GRANT update (admin status management)
--   * no DELETE grant (nobody deletes orders via the Data API)
--   * place_order RPC - untouched (security definer)
--   * Midtrans webhook / status routes (service role) - untouched
--
-- Idempotent: safe to run repeatedly (DROP ... IF EXISTS / REVOKE).

-- 1. Remove the permissive INSERT policies
drop policy if exists "Customers can create own orders" on public.orders;
drop policy if exists "Customers can create order items for own orders" on public.order_items;

-- 2. Revoke Data-API INSERT privileges from the authenticated role
revoke insert on public.orders from authenticated;
revoke insert on public.order_items from authenticated;
