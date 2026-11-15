import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PRODUCT_TYPES } from "../../modules/catalog/domain/services/product-type-validation.js";

/** The caller holds the canonical merchant lock for the entire offer write.
 * This guard governs new catalog state, never historical checkout snapshots. */
export async function assertCatalogBusinessMode(
  tx: Pick<Prisma.TransactionClient, "merchant" | "product" | "serviceReservation">,
  merchantId: string,
  type: string,
): Promise<void> {
  if (!(PRODUCT_TYPES as readonly string[]).includes(type)) throw new BadRequestException("invalid_product_type");
  const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: {
    businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true, storeSettings: true,
  } });
  if (!merchant) throw new NotFoundException("merchant_not_found");
  const settings = merchant.storeSettings && typeof merchant.storeSettings === "object" && !Array.isArray(merchant.storeSettings)
    ? merchant.storeSettings as Record<string, unknown> : {};
  if (!merchant.businessModeSelectedAt && (settings.registration_pending === true || settings.oauth_registration_pending === true))
    throw new ConflictException("business_mode_selection_required");
  const ambiguous = merchant.businessModeNeedsReview || (!merchant.businessModeSelectedAt &&
    (merchant.businessMode === "services" || await tx.product.count({ where: { merchantId, type: "service" } }) > 0
      || await tx.serviceReservation.count({ where: { merchantId } }) > 0));
  if (ambiguous) throw new ConflictException("business_mode_classification_required");
  if ((merchant.businessMode === "services") !== (type === "service")) throw new ConflictException("catalog_business_mode_conflict");
}
