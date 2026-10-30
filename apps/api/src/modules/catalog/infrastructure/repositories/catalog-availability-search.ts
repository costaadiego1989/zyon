import { contextualSearchGroups } from "../../domain/services/contextual-product-search.js";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SearchProductsInput } from "../../domain/ports/product-repository.port.js";
import { isDigitalContentReady } from "../../domain/services/product-type-validation.js";
import { validateFoodMetadata } from "../../domain/services/food-options-validation.js";
import { isServiceOfferAvailable } from "../../domain/services/service-schedule.js";
import { publicProductReviewsSql } from "./public-product-reviews.reader.js";

const BROWSE_TERMS = new Set(["produtos", "produto", "tudo", "catálogo", "catalogo", "ver tudo", "todos", "listar", "mostrar", "*", "all", "ver produtos"]);
const relations = {
  variants: { include: { price: true, stock: true, media: { orderBy: { order: "asc" as const } } } },
  reviews: { where: { approved: true, OR: [{ moderationStatus: null }, { moderationStatus: "approved" }] }, select: { rating: true } },
};

/** Availability is applied before count/pagination, including accent matches.
 * PostgreSQL aggregates physical stock; digital URL validation stays in the
 * domain rather than approximating URL parsing with an SQL regular expression.
 */
export async function searchAvailableCatalog(prisma: PrismaClient, input: SearchProductsInput) {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 20)));
  const query = input.query?.trim().toLowerCase() ?? "";
  const normalizedQuery = BROWSE_TERMS.has(query) ? "" : query.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  return prisma.$transaction(async tx => {
    // Validate digital content, food options and service slots in this tenant/category. A draft
    // with legacy invalid metadata must not become purchasable in a search.
    const configuredCandidates = await tx.product.findMany({
      where: {
        merchantId: input.merchantId, type: { in: ["digital", "food", "service"] }, isActive: true, deletedAt: null,
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        variants: { some: { isActive: true } },
      },
      select: { id: true, type: true, metadata: true },
    });
    const readyDigitalIds = configuredCandidates.filter(p => p.type === "digital" && isDigitalContentReady(p.metadata)).map(p => p.id);
    const readyFoodIds = configuredCandidates.filter(p => p.type === "food" && !validateFoodMetadata(p.metadata)).map(p => p.id);
    const now = new Date();
    const readyServiceIds = configuredCandidates.filter(p => p.type === "service" && isServiceOfferAvailable(p.metadata, now)).map(p => p.id);
    const category = input.categoryId ? Prisma.sql`AND p.category_id = ${input.categoryId}` : Prisma.empty;
    const searchable = Prisma.sql`lower(regexp_replace(normalize(
      p.name || ' ' || coalesce(p.description, '') || ' ' || array_to_string(p.keywords, ' ') || ' ' || coalesce((
        SELECT string_agg(concat_ws(' ', b.props->>'text', b.props->>'heading', b.props->>'title',
          b.props->>'caption', b.props->>'items', b.props->>'rows'), ' ')
        FROM product_content_blocks b WHERE b.product_id = p.id AND b.is_enabled AND b.locale = 'pt-BR'
      ), ''), NFD), '[\u0300-\u036f]', '', 'g'))`;
    const groups = input.queryMode === "contextual" ? contextualSearchGroups(query) : [];
    const text = input.queryMode === "contextual"
      ? groups.length ? Prisma.sql`AND ${Prisma.join(groups.map(group => Prisma.sql`(
          ${Prisma.join(group.map(term => Prisma.sql`strpos(${searchable}, ${term}) > 0`), " OR ")}
        )`), " AND ")}` : Prisma.sql`AND FALSE`
      : normalizedQuery ? Prisma.sql`AND (
        strpos(lower(regexp_replace(normalize(p.name, NFD), '[\u0300-\u036f]', '', 'g')), ${normalizedQuery}) > 0
        OR strpos(lower(regexp_replace(normalize(coalesce(p.description, ''), NFD), '[\u0300-\u036f]', '', 'g')), ${normalizedQuery}) > 0
      )` : Prisma.empty;
    const active = input.status === "inactive" ? Prisma.sql`AND NOT p.is_active`
      : input.inStockOnly || input.isActiveOnly || input.status === "active" ? Prisma.sql`AND p.is_active` : Prisma.empty;
    const price = Prisma.sql`
      ${input.currency ? Prisma.sql`AND EXISTS (SELECT 1 FROM product_prices pr WHERE pr.variant_id = v.id AND pr.currency = ${input.currency})` : Prisma.empty}
      ${input.minPriceCents != null ? Prisma.sql`AND EXISTS (SELECT 1 FROM product_prices pr WHERE pr.variant_id = v.id AND pr.base_price_in_cents >= ${input.minPriceCents})` : Prisma.empty}
      ${input.maxPriceCents != null ? Prisma.sql`AND EXISTS (SELECT 1 FROM product_prices pr WHERE pr.variant_id = v.id AND pr.base_price_in_cents <= ${input.maxPriceCents})` : Prisma.empty}`;
    const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const normalizedSql = (expression: Prisma.Sql) => Prisma.sql`lower(trim(regexp_replace(normalize(${expression}, NFD), '[\u0300-\u036f]', '', 'g')))`;
    const attributes = input.attributes?.length ? Prisma.join(input.attributes.map(condition => Prisma.sql`AND EXISTS (
      SELECT 1 FROM jsonb_each_text(CASE WHEN jsonb_typeof(v.attributes) = 'object' THEN v.attributes ELSE '{}'::jsonb END) attribute
      WHERE ${normalizedSql(Prisma.sql`attribute.key`)} = ${normalized(condition.name)}
        AND ${condition.operator === "equals"
          ? Prisma.sql`${normalizedSql(Prisma.sql`attribute.value`)} = ${normalized(condition.value)}`
          : Prisma.sql`${normalizedSql(Prisma.sql`attribute.value`)} <> ${normalized(condition.value)}`}
    )`), " ") : Prisma.empty;
    const available = input.inStockOnly ? Prisma.sql`AND (
      (p.type = 'service' AND p.id = ANY(${readyServiceIds}::text[]))
      OR (p.type = 'digital' AND p.id = ANY(${readyDigitalIds}::text[]))
      OR (p.type NOT IN ('digital', 'service') AND (p.type <> 'food' OR p.id = ANY(${readyFoodIds}::text[])) AND (
        SELECT coalesce(sum(s.quantity::bigint - s.reserved::bigint), 0)
        FROM product_stock s WHERE s.variant_id = v.id
      ) > 0)
    )` : Prisma.empty;
    const eligibleVariant = Prisma.sql`v.product_id = p.id AND v.is_active ${price} ${available} ${input.attributes?.length ? attributes : Prisma.empty}`;
    const rating = Prisma.sql`(SELECT avg(r.rating) FROM public_reviews r WHERE r.product_id = p.id)`;
    const publicReviews = Prisma.sql`public_reviews AS (${publicProductReviewsSql(input.merchantId)})`;
    const where = Prisma.sql`
      p.merchant_id = ${input.merchantId} AND p.deleted_at IS NULL ${active}
      ${category} ${text}
      ${input.minRating !== undefined ? Prisma.sql`AND ${rating} >= ${input.minRating}` : Prisma.empty}
      AND EXISTS (
        SELECT 1 FROM product_variants v
        WHERE ${eligibleVariant}
      )`;
    // Use the database timestamp for the cursor, preserving sub-millisecond
    // precision and a stable ID tie-breaker for products created together.
    const rankedSort = input.sortBy && input.sortBy !== "newest";
    const afterCursor = !rankedSort && input.cursor && input.offset == null ? Prisma.sql`
      AND (p.created_at, p.id) < (
        SELECT c.created_at, c.id FROM products c
        WHERE c.id = ${input.cursor} AND c.merchant_id = ${input.merchantId}
      )` : Prisma.empty;
    const offset = Math.max(0, Math.trunc(input.offset ?? 0));
    const sortPrice = Prisma.sql`(SELECT min(pr.base_price_in_cents) FROM product_variants v
      JOIN product_prices pr ON pr.variant_id = v.id WHERE ${eligibleVariant})`;
    const ordering = input.sortBy === "price_asc" ? Prisma.sql`sort_price ASC, created_at DESC, id DESC`
      : input.sortBy === "price_desc" ? Prisma.sql`sort_price DESC, created_at DESC, id DESC`
        : Prisma.sql`sort_rating DESC NULLS LAST, created_at DESC, id DESC`;
    // Rank the complete eligible set before slicing, including tie-breakers.
    // Cursor lookup stays in the same tenant and exact filtered candidate set.
    type Hit = { id: string; average_rating: number | null; review_count: number };
    const reviewCount = Prisma.sql`(SELECT count(*)::integer FROM public_reviews r WHERE r.product_id = p.id)`;
    const ids = await tx.$queryRaw<Hit[]>(rankedSort ? Prisma.sql`
      WITH ${publicReviews}, candidates AS (
        SELECT p.id, p.created_at, ${sortPrice} AS sort_price, ${rating} AS sort_rating, ${reviewCount} AS review_count
        FROM products p WHERE ${where}
      ), ranked AS (
        SELECT *, row_number() OVER (ORDER BY ${ordering}) AS position FROM candidates
      )
      SELECT id, sort_rating::double precision AS average_rating, review_count FROM ranked
      ${input.cursor && input.offset == null ? Prisma.sql`WHERE position > coalesce((SELECT position FROM ranked WHERE id = ${input.cursor}), 9223372036854775807)` : Prisma.empty}
      ORDER BY position LIMIT ${limit + 1} OFFSET ${offset}
    ` : Prisma.sql`
      WITH ${publicReviews}
      SELECT p.id, ${rating}::double precision AS average_rating, ${reviewCount} AS review_count FROM products p WHERE ${where} ${afterCursor}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ${limit + 1} OFFSET ${offset}
    `);
    const [count] = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      WITH ${publicReviews}
      SELECT count(*) AS total FROM products p WHERE ${where}
    `);
    const pageIds = ids.slice(0, limit).map(p => p.id);
    const rows = pageIds.length ? await tx.product.findMany({
      where: { merchantId: input.merchantId, id: { in: pageIds } }, include: {
        ...relations,
        reviews: { ...relations.reviews, where: { ...relations.reviews.where,
          AND: [{ OR: [{ merchantId: input.merchantId }, { merchantId: null }] }] } },
      },
    }) : [];
    const order = new Map(pageIds.map((id, index) => [id, index]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return {
      rows,
      publicRatings: new Map(ids.map(hit => [hit.id, { averageRating: hit.average_rating == null ? undefined : Number(hit.average_rating), reviewCount: Number(hit.review_count ?? 0) }])),
      total: Number(count.total),
      nextCursor: ids.length > limit ? pageIds[pageIds.length - 1] : undefined,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
