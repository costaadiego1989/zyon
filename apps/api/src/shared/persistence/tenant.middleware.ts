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

export function shouldInjectTenant(model: string, operation: string): boolean {
  return TENANT_SCOPED_MODELS.has(model) && TENANT_SCOPED_ACTIONS.has(operation);
}

export function injectMerchantId(
  args: Record<string, unknown>,
  merchantId: string
): Record<string, unknown> {
  const where = (args.where ?? {}) as Record<string, unknown>;
  return { ...args, where: { ...where, merchantId } };
}

export function registerTenantMiddleware(prisma: PrismaClient, tenantCtx: TenantContextService) {
  return prisma.$extends({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          const ctx = tenantCtx.get();
          if (ctx && shouldInjectTenant(model as string, operation as string)) {
            args = injectMerchantId(args as Record<string, unknown>, ctx.merchantId);
          }
          return query(args);
        },
      },
    },
  });
}
