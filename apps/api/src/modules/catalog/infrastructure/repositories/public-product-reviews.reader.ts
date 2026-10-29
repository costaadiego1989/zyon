import { Prisma, type PrismaClient } from "@prisma/client";

/** Both supported review sources obey the same public visibility and tenant rules. */
export function publicProductReviewsSql(merchantId: string, productId?: string): Prisma.Sql {
  if (!merchantId.trim()) throw new Error("review_merchant_required");
  return Prisma.sql`
    SELECT ('review:' || r.id) AS id, r.product_id, 'Cliente'::text AS author,
      r.rating, COALESCE(r.text, r.body, '') AS text, r.created_at
    FROM product_reviews r
    JOIN products p ON p.id = r.product_id
    WHERE p.merchant_id = ${merchantId} AND p.is_active = true
      AND (r.merchant_id = ${merchantId} OR r.merchant_id IS NULL)
      AND r.approved = true
      AND (r.moderation_status = 'approved' OR r.moderation_status IS NULL)
      AND r.rating BETWEEN 1 AND 5
      ${productId ? Prisma.sql`AND r.product_id = ${productId}` : Prisma.empty}
    UNION ALL
    SELECT ('testimonial:' || t.id) AS id, t.product_id, t.author_name AS author,
      t.rating, t.body AS text, t.created_at
    FROM product_testimonials t
    JOIN products p ON p.id = t.product_id
    WHERE p.merchant_id = ${merchantId} AND p.is_active = true
      AND t.is_published = true AND t.moderation_status = 'approved'
      AND t.locale = 'pt-BR' AND t.rating BETWEEN 1 AND 5
      ${productId ? Prisma.sql`AND t.product_id = ${productId}` : Prisma.empty}
  `;
}

export interface PublicProductReviewsInput {
  merchantId: string;
  productId?: string;
  filter?: "positive" | "negative" | "recent";
  cursor?: string;
  limit?: number;
}

/** One bounded aggregate for cards and search projections, using exactly the
 * visibility rules used by the public review list and numeric search filter. */
export async function readPublicProductRatingStats(prisma: Pick<PrismaClient, "$queryRaw">, merchantId: string, productIds: string[]) {
  if (!productIds.length) return new Map<string, { averageRating?: number; reviewCount: number }>();
  const rows = await prisma.$queryRaw<Array<{ product_id: string; average_rating: number; review_count: number }>>(Prisma.sql`
    SELECT product_id, AVG(rating)::double precision AS average_rating, COUNT(*)::integer AS review_count
    FROM (${publicProductReviewsSql(merchantId)}) public_reviews
    WHERE product_id = ANY(${productIds}::text[]) GROUP BY product_id
  `);
  return new Map(rows.map(row => [row.product_id, { averageRating: row.average_rating, reviewCount: row.review_count }]));
}

export async function readPublicProductReviews(prisma: Pick<PrismaClient, "$queryRaw">, input: PublicProductReviewsInput) {
  const limit = Math.max(1, Math.min(20, Math.floor(Number(input.limit) || 10)));
  const cursor = input.cursor ?? null;
  const ratingFilter = input.filter === "positive" ? Prisma.sql`AND rating >= 4`
    : input.filter === "negative" ? Prisma.sql`AND rating <= 2` : Prisma.empty;
  const [result] = await prisma.$queryRaw<Array<{
    totalCount: number; averageRating: number; cursorValid: boolean;
    reviews: Array<{ id: string; author: string; rating: number; text: string; date: string }>;
  }>>(Prisma.sql`
    WITH public_reviews AS (${publicProductReviewsSql(input.merchantId, input.productId)}),
    filtered_reviews AS (SELECT * FROM public_reviews WHERE true ${ratingFilter}),
    cursor_row AS (SELECT id, created_at FROM filtered_reviews WHERE id = ${cursor}),
    review_page AS (
      SELECT r.* FROM filtered_reviews r
      WHERE ${cursor}::text IS NULL OR EXISTS (
        SELECT 1 FROM cursor_row c
        WHERE r.created_at < c.created_at
          OR (r.created_at = c.created_at AND r.id COLLATE "C" < c.id COLLATE "C")
      )
      ORDER BY r.created_at DESC, r.id COLLATE "C" DESC LIMIT ${limit + 1}
    )
    SELECT (SELECT COUNT(*)::integer FROM filtered_reviews) AS "totalCount",
      COALESCE((SELECT ROUND(AVG(rating)::numeric, 1)::double precision FROM filtered_reviews), 0) AS "averageRating",
      (${cursor}::text IS NULL OR EXISTS (SELECT 1 FROM cursor_row)) AS "cursorValid",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'author', author, 'rating', rating,
        'text', text, 'date', to_char(created_at, 'YYYY-MM-DD'))
        ORDER BY created_at DESC, id COLLATE "C" DESC) FROM review_page), '[]'::jsonb) AS reviews
  `);
  if (!result) throw new Error("reviews_read_unavailable");
  if (!result.cursorValid) return { error: "review_cursor_invalid", reviews: [] };
  const reviews = result.reviews.slice(0, limit);
  return { reviews, totalCount: result.totalCount, averageRating: result.averageRating,
    filter: input.filter, nextCursor: result.reviews.length > limit ? reviews.at(-1)!.id : undefined };
}
