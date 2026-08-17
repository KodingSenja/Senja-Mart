export interface Category {
  id: string;
  name: string;
  slug: string;
  image: string;
  description?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  productCount?: number;
}
