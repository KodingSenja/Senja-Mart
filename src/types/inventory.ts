/** Status stok berdasarkan stok vs ambang minimum. */
export type StockStatus = 'safe' | 'low' | 'out';

/** Jenis perubahan stok yang tercatat di stock_movements. */
export type StockMovementType =
  | 'restock'
  | 'sale'
  | 'adjustment'
  | 'cancellation'
  | 'refund';

export interface InventoryProduct {
  id: string;
  name: string;
  slug: string;
  image: string;
  price: number;
  categoryId: string | null;
  categoryName: string | null;
  stock: number;
  reservedStock: number;
  lowStockThreshold: number;
  isActive: boolean;
}

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  referenceType: string;
  referenceId: string | null;
  note: string | null;
  adminName: string | null;
  createdAt: string;
}
