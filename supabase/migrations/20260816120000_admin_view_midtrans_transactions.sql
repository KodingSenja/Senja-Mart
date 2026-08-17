-- ============================================
-- SENJA MART - ADMIN VIEW MIDTRANS TRANSACTIONS
-- ============================================
-- P1 audit fix: the admin dashboard (authenticated role) cannot show the
-- Midtrans transaction ID / payment-attempt status in the Order Detail.
-- The only SELECT policy on `midtrans_transactions` is the customer-own
-- policy ("Customers can view own payment transactions"), so an admin can
-- only see transactions belonging to orders they personally own (e.g. test
-- orders created by the admin account) — never transactions of real
-- customers. Operations therefore has no way to look up a payment attempt
-- for support / dispute handling.
--
-- Fix (SELECT only, additive, mirrors every other admin policy in the
-- project which uses public.is_admin()):
--   * new admin SELECT policy  -> admins may read all payment attempts
--   * idempotent GRANT re-assertion of the existing authenticated SELECT
--     table privilege (mirrors the project's M9 "grant mirrors RLS" pattern)
--
-- NOT touched:
--   * customer SELECT policy (kept as-is)
--   * service_role privileges (kept as-is)
--   * INSERT / UPDATE / DELETE (no new write access for anyone)
--   * table schema, existing data, Midtrans webhook, payment flow, checkout
--   * orders / order_items RLS (Task 1) — untouched
--
-- Idempotent: safe to run repeatedly (CREATE POLICY would error on re-run
-- only if it already exists; this file is a one-time migration, and the
-- GRANT is a no-op when already granted).

create policy "Admins can view payment transactions"
  on public.midtrans_transactions for select
  to authenticated
  using (public.is_admin());

-- The Data API can only use the policy when the role holds the table
-- privilege. Verified present on the remote DB; re-asserted for robustness
-- (no-op when already granted).
grant select on public.midtrans_transactions to authenticated;
