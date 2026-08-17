export type MarketingContentType = 'hero' | 'banner';

export interface MarketingContent {
  id: string;
  type: MarketingContentType;
  imageUrl: string;
  badge?: string | null;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  ctaText?: string | null;
  ctaUrl?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}
