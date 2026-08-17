-- ============================================
-- SENJA MART - FIX REVIEW RATING & STORAGE BUCKET
-- ============================================
-- Fixes two issues proven by the REAL SUPABASE INTEGRATION TEST (round 2):
--
--   T10: public.recompute_product_rating() was created WITHOUT
--        SECURITY DEFINER, so the AFTER INSERT/UPDATE/DELETE trigger on
--        public.reviews ran with the caller's privileges. When a customer
--        wrote a review, the UPDATE on public.products inside the trigger
--        was filtered out by RLS (products has no customer UPDATE policy)
--        -> products.rating / products.review_count never changed.
--
--   T11: the 'product-images' storage bucket was missing on the remote
--        project (the INSERT in migration 103000 did not survive the
--        current DB state), so Admin CRUD image uploads would fail with
--        "Bucket not found". Re-created idempotently.
--
-- No old migration is modified. No destructive operation. The trigger
-- (reviews_recompute_product_rating) already points to this function name
-- and does not need to change.

-- ------------------------------------------------------------------
-- T10 — recompute_product_rating(): SECURITY DEFINER, RLS-safe
-- ------------------------------------------------------------------
-- Pattern consistent with is_admin() / handle_new_user(): SECURITY DEFINER
-- + set search_path = public. Behaviour is unchanged (AVG rating rounded
-- to 1 decimal, COUNT(*) review_count, NULL -> 0).
create or replace function public.recompute_product_rating()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.products
  set rating = coalesce(
        (select round(avg(r.rating)::numeric, 1)
           from public.reviews r where r.product_id = coalesce(new.product_id, old.product_id)),
        0),
      review_count = (
        select count(*) from public.reviews r
        where r.product_id = coalesce(new.product_id, old.product_id))
  where id = coalesce(new.product_id, old.product_id);
  return null;
end;
$$;

-- ------------------------------------------------------------------
-- T11 — restore 'product-images' storage bucket (idempotent)
-- ------------------------------------------------------------------
-- Safe to run repeatedly: ON CONFLICT DO NOTHING when the bucket already
-- exists; never deletes or touches existing objects. Public=true matches
-- the app's needs (storefront reads images without auth).
--
-- Storage RLS policies already exist in migration 103000
-- ("Public can view product images", "Admins can upload/update/delete
-- product images") — they key on bucket_id = 'product-images', so no new
-- policy is added here and nothing is made more permissive.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;
