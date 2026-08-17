'use client';

import type { Cart, CartItem } from 'types/cart';
import type { Product } from 'types/product';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

const STORAGE_KEY = 'senjamart-cart';

/** Load the cart from localStorage (browser only). */
export function loadCart(): Cart {
  if (typeof window === 'undefined') return { items: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [] };
    const parsed = JSON.parse(raw) as Cart;
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

function persist(cart: Cart): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
}

export function addItem(cart: Cart, product: Product, quantity = 1): Cart {
  const existing = cart.items.find((i) => i.productId === product.id);
  let items: CartItem[];
  if (existing) {
    items = cart.items.map((i) =>
      i.productId === product.id
        ? { ...i, quantity: i.quantity + quantity }
        : i
    );
  } else {
    items = [...cart.items, { productId: product.id, quantity, product }];
  }
  const next: Cart = { items };
  persist(next);
  return next;
}

export function removeItem(cart: Cart, productId: string): Cart {
  const next: Cart = {
    items: cart.items.filter((i) => i.productId !== productId),
  };
  persist(next);
  return next;
}

export function updateQuantity(
  cart: Cart,
  productId: string,
  quantity: number
): Cart {
  if (quantity <= 0) return removeItem(cart, productId);
  const next: Cart = {
    items: cart.items.map((i) =>
      i.productId === productId ? { ...i, quantity } : i
    ),
  };
  persist(next);
  return next;
}

export function clearCart(): Cart {
  persist({ items: [] });
  return { items: [] };
}

/** Total quantity of items in the cart. */
export function cartItemCount(cart: Cart): number {
  return cart.items.reduce((sum, i) => sum + i.quantity, 0);
}

/** Subtotal of the cart in Rupiah. */
export function cartSubtotal(cart: Cart): number {
  return cart.items.reduce((sum, i) => sum + i.quantity * i.product.price, 0);
}

// ------------------------------------------------------------------
// Supabase persistence (authenticated users only)
// ------------------------------------------------------------------

interface CartRow {
  product_id: string;
  quantity: number;
  products: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    price: number | string;
    compare_price: number | string | null;
    image_url: string | null;
    unit: string | null;
    stock: number;
  }> | null;
}

const CART_SELECT = 'product_id, quantity, products:products(id, name, slug, description, price, compare_price, image_url, unit, stock)';

/**
 * Fetch the authenticated user's cart from the `cart_items` table.
 * Returns an empty cart when signed out or when Supabase isn't configured.
 */
export async function fetchCartFromSupabase(): Promise<Cart> {
  if (!isSupabaseConfigured || !supabase) return { items: [] };
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return { items: [] };

  const { data, error } = await supabase
    .from('cart_items')
    .select(CART_SELECT)
    .eq('user_id', user.user.id)
    .order('created_at');

  if (error || !data) return { items: [] };

  const items: CartItem[] = (data as CartRow[])
    .filter((r) => r.products && r.products.length > 0)
    .map((r) => {
      const p = r.products![0];
      return {
        productId: r.product_id,
        quantity: r.quantity,
        product: {
          id: p.id,
          name: p.name,
          slug: p.slug,
          description: p.description ?? '',
          price: Number(p.price) || 0,
          compareAtPrice: p.compare_price != null ? Number(p.compare_price) : null,
          image: p.image_url ?? '',
          images: p.image_url ? [p.image_url] : [],
          categoryId: null,
          unit: p.unit ?? '',
          rating: 0,
          reviewCount: 0,
          badge: null,
          stock: p.stock ?? 0,
          featured: false,
        },
      };
    });
  return { items };
}

/**
 * Replace the user's Supabase cart with the given cart (full sync).
 * Call after every cart mutation while signed in.
 */
export async function syncCartToSupabase(cart: Cart): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return;

  // Full replace: delete then insert (cart is small, keeps upserts simple).
  await supabase.from('cart_items').delete().eq('user_id', user.user.id);

  if (cart.items.length === 0) return;

  const rows = cart.items.map((i) => ({
    user_id: user.user!.id,
    product_id: i.productId,
    quantity: i.quantity,
  }));
  const { error } = await supabase.from('cart_items').insert(rows);
  if (error) {
    // Non-fatal: local cart remains the source of truth for the session.
    console.error('Gagal menyinkronkan keranjang ke Supabase:', error.message);
  }
}
