import type { Product } from './product';

export interface CartItem {
  productId: string;
  quantity: number;
  product: Product;
}

export interface Cart {
  items: CartItem[];
}

export type CartAction =
  | { type: 'ADD_ITEM'; product: Product; quantity?: number }
  | { type: 'REMOVE_ITEM'; productId: string }
  | { type: 'UPDATE_QUANTITY'; productId: string; quantity: number }
  | { type: 'CLEAR' };
