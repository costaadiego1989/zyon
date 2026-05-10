import type { PrismaClient } from "@prisma/client";
import type { TenantContextService } from "../tenant/tenant-context.service.js";

export type TenantContext = { merchantId: string; userId: string; role: string };

const TENANT_SCOPED_MODELS = new Set([
  "CheckoutSession",
  "Offer",
  "Order",
  "OutboxEvent",
  "NegotiationSession",
  "MerchantNegotiationPolicy",
  "BuyerAgentPreferences",
  "Payment",
]);

const TENANT_SCOPED_ACTIONS = new Set([
  "findMany",
  "findFirst",
  "findUnique",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

export function registerTenantMiddleware(prisma: PrismaClient, tenantCtx: TenantContextService): void {
  // @ts-expect-error Prisma middleware API
  prisma.$use(async (params: Record<string, unknown>, next: (p: Record<string, unknown>) => Promise<unknown>) => {
    const ctx = tenantCtx.get();
    if (
      ctx &&
      TENANT_SCOPED_ACTIONS.has(params.action as string) &&
      TENANT_SCOPED_MODELS.has(params.model as string)
    ) {
      const args = (params.args ?? {}) as Record<string, unknown>;
      const where = (args.where ?? {}) as Record<string, unknown>;
      args.where = { ...where, merchantId: ctx.merchantId };
      params = { ...params, args };
    }
    return next(params);
  });
}
