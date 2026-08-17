'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Cart } from 'types/cart';
import type { Product } from 'types/product';
import {
  addItem as addItemService,
  cartItemCount,
  cartSubtotal,
  clearCart as clearCartService,
  loadCart,
  removeItem as removeItemService,
  updateQuantity as updateQuantityService,
  fetchCartFromSupabase,
  syncCartToSupabase,
} from 'lib/services/cart';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

interface CartContextValue {
  cart: Cart;
  itemCount: number;
  subtotal: number;
  isSynced: boolean;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>({ items: [] });
  const [isSynced, setIsSynced] = useState(false);

  // Serialize Supabase syncs so delete-all + insert-all calls never
  // complete out of order (which would leave a stale cart in the DB).
  const syncQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingCart = useRef<Cart | null>(null);
  const syncedRef = useRef(false);

  const enqueueSync = (next: Cart) => {
    pendingCart.current = next;
    // Serialize: only the latest pending cart gets written to Supabase.
    syncQueue.current = syncQueue.current
      .then(async () => {
        if (!pendingCart.current) return;
        const toWrite = pendingCart.current;
        pendingCart.current = null;
        if (!isSupabaseConfigured || !supabase) return;
        if (!syncedRef.current) return;
        await syncCartToSupabase(toWrite);
      })
      .catch(() => undefined);
  };

  // Hydrate from localStorage on mount (client only).
  useEffect(() => {
    setCart(loadCart());
  }, []);

  // When auth state changes, load / merge the Supabase cart.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let active = true;

    const loadRemoteCart = async () => {
      const remote = await fetchCartFromSupabase();
      if (!active) return;
      if (remote.items.length > 0) {
        setCart((prev) => {
          const merged = [...remote.items];
          for (const item of prev.items) {
            if (!merged.some((m) => m.productId === item.productId)) {
              merged.push(item);
            }
          }
          return { items: merged };
        });
      }
      syncedRef.current = true;
      setIsSynced(true);
    };

    loadRemoteCart();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      syncedRef.current = false;
      setIsSynced(false);
      // Re-fetch after sign in / out events settle.
      window.setTimeout(loadRemoteCart, 400);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<CartContextValue>(() => {
    const persist = (next: Cart) => {
      setCart(next);
      enqueueSync(next);
    };
    return {
      cart,
      itemCount: cartItemCount(cart),
      subtotal: cartSubtotal(cart),
      isSynced,
      addItem: (product, quantity = 1) =>
        persist(addItemService(cart, product, quantity)),
      removeItem: (productId) =>
        persist(removeItemService(cart, productId)),
      updateQuantity: (productId, quantity) =>
        persist(updateQuantityService(cart, productId, quantity)),
      clearCart: () => persist(clearCartService()),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, isSynced]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
