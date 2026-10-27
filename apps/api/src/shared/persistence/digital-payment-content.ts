import type { Prisma } from "@prisma/client";
import { isDigitalContentReady } from "../../modules/catalog/domain/services/product-type-validation.js";

export interface DigitalPaymentContent {
  variantId: string;
  sku: string;
  productName: string;
  downloadUrl: string;
  downloadExpiryDays: number;
  requiredChannels?: string[];
}

/** Uses only the canonical server cart; private content never enters a cart response. */
export async function snapshotDigitalPaymentContent(tx: Prisma.TransactionClient, merchantId: string, sessionId: string): Promise<DigitalPaymentContent[]> {
  const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId } }, select: { cart: true } });
  const items = (session?.cart as { items?: Array<{ sku: string; variantId?: string; productType?: string; marketplace?: unknown }> } | null)?.items;
  const digital = Array.isArray(items) ? items.filter(item => item.productType === "digital") : [];
  if (!digital.length) return [];
  if (digital.some(item => item.marketplace)) throw new Error("marketplace_digital_fulfillment_unavailable");
  const variants = await tx.productVariant.findMany({ where: { sku: { in: digital.map(item => item.sku) }, isActive: true,
    product: { merchantId, type: "digital", isActive: true, deletedAt: null } }, include: { product: true } });
  return [...new Map(digital.map(item => [item.sku, item])).values()].map(item => {
    const matches = variants.filter(variant => variant.sku === item.sku && (!item.variantId || item.variantId === variant.id));
    if (matches.length !== 1 || !isDigitalContentReady(matches[0]!.product.metadata)) throw new Error("checkout_digital_content_unavailable");
    const variant = matches[0]!, metadata = variant.product.metadata as Record<string, unknown>;
    return { variantId: variant.id, sku: variant.sku, productName: variant.product.name, downloadUrl: metadata.downloadUrl as string,
      requiredChannels: Array.isArray(metadata.digitalDeliveryChannels) && metadata.digitalDeliveryChannels.length > 0 && metadata.digitalDeliveryChannels.every(channel => channel === "email" || channel === "whatsapp")
        ? [...new Set(metadata.digitalDeliveryChannels as string[])] : ["email"],
      downloadExpiryDays: metadata.downloadExpiryDays === undefined ? 30 : Number(metadata.downloadExpiryDays) };
  });
}
