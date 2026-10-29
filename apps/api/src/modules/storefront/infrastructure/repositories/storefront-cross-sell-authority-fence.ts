import type { Prisma } from "@prisma/client";
import { lockCatalogMerchant } from "../../../../shared/persistence/catalog-stock-ledger.js";
import type { CrossSellStorefrontQuote } from "../../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";

/** Same existing merchant row as catalog create/update/variant/stock writers.
 * Config rows also serialize direct UPDATE/DELETE writers that do not acquire
 * the merchant fence. Always call BEFORE checkout/cart locks, never upgrade
 * from a previously acquired cart fence. No policy provisioning. */
export async function lockCrossSellMerchantAuthority(tx: Prisma.TransactionClient, merchantId: string): Promise<void> {
  await lockCatalogMerchant(tx, merchantId);
  await tx.$queryRaw`SELECT merchant_id FROM merchant_rules WHERE merchant_id = ${merchantId} FOR SHARE`;
  await tx.$queryRaw`SELECT merchant_id FROM checkout_settings WHERE merchant_id = ${merchantId} FOR SHARE`;
}

/** Exact bounded rows referenced by this cart/selection, deterministic order.
 * Readers MUST run again after these waits in the same ReadCommitted tx.
 * This is not a table/predicate lock or a global snapshot of future promotions.
 * A cart is not stock reservation; stock is rechecked admission evidence only. */
export async function lockCrossSellSelectedAuthority(tx: Prisma.TransactionClient, merchantId: string,
  basis: CrossSellStorefrontQuote["cartBasis"], variantId: string, promotionId: string): Promise<void> {
  const ids = [...new Set([...basis.items.map(item => item.variantId), variantId])].sort();
  const promotionIds = [...new Set([promotionId, ...basis.items.flatMap(item => item.crossSellIntent ? [item.crossSellIntent.promotionId] : [])])].sort();
  await tx.$queryRaw`SELECT p.id FROM products p WHERE p.merchant_id = ${merchantId}
    AND p.id IN (SELECT v.product_id FROM product_variants v WHERE v.id = ANY(${ids}::text[])) ORDER BY p.id FOR SHARE OF p`;
  await tx.$queryRaw`SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
    WHERE p.merchant_id = ${merchantId} AND v.id = ANY(${ids}::text[]) ORDER BY v.id FOR SHARE OF v`;
  await tx.$queryRaw`SELECT price.id FROM product_prices price JOIN product_variants v ON v.id = price.variant_id
    JOIN products p ON p.id = v.product_id WHERE p.merchant_id = ${merchantId}
    AND v.id = ANY(${ids}::text[]) ORDER BY price.id FOR SHARE OF price`;
  await tx.$queryRaw`SELECT stock.id FROM product_stock stock JOIN product_variants v ON v.id = stock.variant_id
    JOIN products p ON p.id = v.product_id WHERE p.merchant_id = ${merchantId}
    AND v.id = ANY(${ids}::text[]) ORDER BY stock.id FOR SHARE OF stock`;
  await tx.$queryRaw`SELECT promotion.id FROM product_promotions promotion WHERE promotion.merchant_id = ${merchantId}
    AND (promotion.variant_id = ANY(${ids}::text[])
      OR promotion.product_id IN (SELECT v.product_id FROM product_variants v WHERE v.id = ANY(${ids}::text[]))
      OR promotion.category_id IN (SELECT p.category_id FROM products p JOIN product_variants v ON v.product_id = p.id
        WHERE p.merchant_id = ${merchantId} AND v.id = ANY(${ids}::text[]))) ORDER BY promotion.id FOR SHARE OF promotion`;
  await tx.$queryRaw`SELECT promotion.id FROM cross_sell_promotions promotion WHERE promotion.merchant_id = ${merchantId}
    AND promotion.id = ANY(${promotionIds}::text[]) ORDER BY promotion.id FOR SHARE OF promotion`;
}
