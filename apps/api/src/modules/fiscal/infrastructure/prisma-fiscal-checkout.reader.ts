import type { Prisma, PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import type { FiscalCheckoutReaderPort, FiscalCheckoutSellerContext } from "../domain/fiscal-checkout.port.js";
import type { FiscalEnvironment } from "../domain/fiscal-provider.js";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { isFiscalOrderScope } from "../domain/fiscal-order-scope.js";

/** Explicit fiscal environment is supplied by wiring, never a caller's checkout body. */
export class PrismaFiscalCheckoutReader implements FiscalCheckoutReaderPort {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient, private readonly environment: FiscalEnvironment,
    private readonly tenants: TenantContextService) {}
  async load(session: CheckoutSession): Promise<FiscalCheckoutSellerContext[]> {
    const stored = await this.db.checkoutSession.findFirst({ where: { merchantId: session.merchantId, sessionId: session.sessionId }, select: { cart: true } });
    if (!stored) throw new Error("fiscal_checkout_not_found");
    const cart = stored.cart as unknown as CheckoutSession["cart"];
    const cartRef = (cart as { cart_ref?: string }).cart_ref;
    const records = await this.db.crossStoreLineItem.findMany({ where: { hostMerchantId: session.merchantId,
      checkoutSessionId: { in: [...new Set([session.sessionId, cartRef].filter((value): value is string => !!value))] } } });
    const sellers = new Map<string, { sku: string; productType: string }[]>();
    for (const line of cart.items) {
      const record = line.marketplace ? records.find(row => row.id === line.marketplace!.lineItemId) : undefined;
      if (line.marketplace && (!record || record.sellerMerchantId !== line.marketplace.sourceMerchantId)) throw new Error("fiscal_checkout_scope_invalid");
      const merchantId = record?.sellerMerchantId ?? session.merchantId;
      sellers.set(merchantId, [...(sellers.get(merchantId) ?? []), { sku: line.sku, productType: line.productType ?? "unknown" }]);
    }
    // Include persisted sellers even if a stale session omitted marketplace markers.
    for (const record of records) if (!sellers.has(record.sellerMerchantId)) sellers.set(record.sellerMerchantId, [{ sku: record.sourceVariantId ?? "", productType: "unknown" }]);
    // Validate markers above first: caller metadata alone cannot opt out of the
    // normal buyer-data gate. A persisted cross-store sale is outside fiscal V1.
    if (!isFiscalOrderScope(session.merchantId, [...sellers.keys()])) return [];
    const result: FiscalCheckoutSellerContext[] = [];
    for (const [merchantId, lines] of sellers) {
      await this.tenants.run({ merchantId, userId: "fiscal-checkout", role: "system" }, async () => {
        const connection = await this.db.fiscalConnection.findFirst({ where: { merchantId, environment: this.environment, isActive: true, disconnectedAt: null } });
        if (!connection) return;
        const profileScope = { merchantId, environment: this.environment, provider: connection.provider, operation: "sale" };
        const profile = await this.db.fiscalProfileVersion.findFirst({ where: { ...profileScope, confirmedAt: { not: null }, confirmedBy: { not: null } }, orderBy: { version: "desc" } })
          ?? await this.db.fiscalProfileVersion.findFirst({ where: profileScope, orderBy: { version: "desc" } });
        result.push({ merchantId, environment: this.environment, connection, profile, lines });
      });
    }
    return result;
  }
}
