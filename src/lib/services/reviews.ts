import type { CreateReviewInput, Review, ReviewWithAuthor } from 'types/review';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

interface ReviewRow {
  id: string;
  user_id: string;
  product_id: string;
  rating: number;
  review: string | null;
  created_at: string;
}

function mapReview(row: ReviewRow): Review {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    rating: row.rating,
    review: row.review ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Reviews for a product — uses the security-definer RPC so author names are
 * readable without widening profiles RLS.
 */
export async function getReviewsByProduct(productId: string): Promise<ReviewWithAuthor[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase.rpc('get_product_reviews', {
    p_product_id: productId,
  });
  if (error || !data) return [];
  return (data as (ReviewRow & { author_name: string | null })[]).map((r) => ({
    ...mapReview(r),
    authorName: r.author_name ?? null,
  }));
}

/** Create a review as the current user (RLS enforces own reviews). */
export async function createReview(input: CreateReviewInput): Promise<Review> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) {
    throw new Error('Silakan masuk terlebih dahulu untuk memberikan ulasan.');
  }

  const { data, error } = await supabase
    .from('reviews')
    .insert({
      user_id: user.user.id,
      product_id: input.productId,
      rating: input.rating,
      review: input.review ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapReview(data as ReviewRow);
}
