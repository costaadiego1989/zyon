import { Prisma, type PrismaClient } from "@prisma/client";
import type { SearchProductsInput } from "../../domain/ports/product-repository.port.js";
import { isDigitalContentReady } from "../../domain/services/product-type-validation.js";
import { validateFoodMetadata } from "../../domain/services/food-options-validation.js";
import { isServiceOfferAvailable } from "../../domain/services/service-schedule.js";

const BROWSE_TERMS = new Set(["produtos", "produto", "tudo", "catálogo", "catalogo", "ver tudo", "todos", "listar", "mostrar", "*", "all", "ver produtos"]);
const relations = {
  variants: { include: { price: true, stock: true, media: { orderBy: { order: "asc" as const } } } },
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
    const text = normalizedQuery ? Prisma.sql`AND (
      strpos(lower(regexp_replace(normalize(p.name, NFD), '[̀-ͯ]', '', 'g')), ${normalizedQuery}) > 0
      OR strpos(lower(regexp_replace(normalize(coalesce(p.description, ''), NFD), '[̀-ͯ]', '', 'g')), ${normalizedQuery}) > 0
    )` : Prisma.empty;
    const where = Prisma.sql`
      p.merchant_id = ${input.merchantId} AND p.deleted_at IS NULL AND p.is_active
      ${category} ${text}
      AND EXISTS (
        SELECT 1 FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active
          AND (
            (p.type = 'service' AND p.id = ANY(${readyServiceIds}::text[]))
            OR (p.type = 'digital' AND p.id = ANY(${readyDigitalIds}::text[]))
            OR (p.type NOT IN ('digital', 'service') AND (p.type <> 'food' OR p.id = ANY(${readyFoodIds}::text[])) AND (
              SELECT coalesce(sum(s.quantity::bigint - s.reserved::bigint), 0)
              FROM product_stock s WHERE s.variant_id = v.id
            ) > 0)
          )
      )`;
    // Use the database timestamp for the cursor, preserving sub-millisecond
    // precision and a stable ID tie-breaker for products created together.
    const afterCursor = input.cursor && input.offset == null ? Prisma.sql`
      AND (p.created_at, p.id) < (
        SELECT c.created_at, c.id FROM products c
        WHERE c.id = ${input.cursor} AND c.merchant_id = ${input.merchantId}
      )` : Prisma.empty;
    const offset = Math.max(0, Math.trunc(input.offset ?? 0));
    const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p.id FROM products p WHERE ${where} ${afterCursor}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ${limit + 1} OFFSET ${offset}
    `);
    const [count] = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT count(*) AS total FROM products p WHERE ${where}
    `);
    const pageIds = ids.slice(0, limit).map(p => p.id);
    const rows = pageIds.length ? await tx.product.findMany({
      where: { merchantId: input.merchantId, id: { in: pageIds } }, include: relations,
    }) : [];
    const order = new Map(pageIds.map((id, index) => [id, index]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return {
      rows,
      total: Number(count.total),
      nextCursor: ids.length > limit ? pageIds[pageIds.length - 1] : undefined,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
