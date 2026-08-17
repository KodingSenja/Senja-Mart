-- ============================================
-- SENJA MART - FIX REGISTRATION DEFAULT CUSTOMER
-- ============================================
-- Security fix: the previous handle_new_user() granted the FIRST registered
-- user the 'admin' role ("first user in the database -> admin"). If the
-- database is ever emptied, anyone who registers first would become admin.
--
-- New behavior: EVERY user that signs up through the app gets role
-- 'customer'. Existing admins are untouched (their profiles.role is not
-- modified by this migration).
--
-- No other schema is changed. The trigger on_auth_user_created is recreated
-- idempotently (same trigger name / same function) so a fresh apply of the
-- whole migration chain works, while re-running this file is a no-op.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1),
      'Pengguna'
    ),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
