export interface Review {
  id: string;
  userId: string;
  productId: string;
  rating: number;
  review?: string | null;
  createdAt: string;
}

/** Review with the author's display name (joined from profiles). */
export interface ReviewWithAuthor extends Review {
  authorName?: string | null;
}

export interface CreateReviewInput {
  productId: string;
  rating: number;
  review?: string;
}
