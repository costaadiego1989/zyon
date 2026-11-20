import type { PrismaClient } from "@prisma/client";
import type { FiscalDeliveryContext } from "../domain/fiscal-delivery.port.js";
import { fiscalBuyerLink } from "../domain/fiscal-buyer-link.js";
export interface FiscalBuyerPortalPort { link(context: FiscalDeliveryContext): Promise<string | null> }
export class FiscalBuyerPortal implements FiscalBuyerPortalPort {
  private readonly origin: string;
  constructor(private readonly prisma: PrismaClient, storefrontOrigin: string) {
    const url = new URL(storefrontOrigin);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("fiscal_storefront_origin_invalid");
    this.origin = url.origin;
  }
  async link(context: FiscalDeliveryContext) {
    const original = context.issuance.snapshot;
    const host = await this.prisma.merchant.findUnique({ where: { id: original.orderMerchantId }, select: { storeSlug: true } });
    return host?.storeSlug ? this.origin + fiscalBuyerLink(host.storeSlug, original.orderId, context.issuance.intent.id, undefined, original.environment) : null;
  }
}
