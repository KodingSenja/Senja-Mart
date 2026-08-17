-- ============================================
-- SENJA MART - RESTORE product-images STORAGE BUCKET
-- ============================================
-- Context: migration 20260810193000 inserted the bucket with
--   ON CONFLICT (id) DO NOTHING, yet the Storage API still reported
--   "Bucket not found" (verified by integration test + live probes).
--
-- This migration makes the bucket row correct regardless of prior state:
--   * no row            -> INSERT creates it (public = true)
--   * row already there -> ON CONFLICT (id) DO UPDATE keeps it public
--
-- Idempotent & non-destructive: safe to run repeatedly; never deletes or
-- touches existing objects; only affects the bucket row itself.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update
  set public = excluded.public;
