-- ============================================
-- SENJA MART - ENABLE REALTIME FOR BEST SELLERS
-- ============================================
-- To trigger the "Produk Terlaris Hari Ini" refetch,
-- the application needs to listen to changes in
-- orders and order_items tables.

begin;
  -- Add tables to the supabase_realtime publication
  alter publication supabase_realtime add table public.orders;
  alter publication supabase_realtime add table public.order_items;
commit;
