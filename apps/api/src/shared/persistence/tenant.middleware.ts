import type { PrismaClient } from "@prisma/client";
import type {
  TenantContext,
  TenantContextService,
} from "../tenant/tenant-context.service.js";
export type { TenantContext } from "../tenant/tenant-context.service.js";

export const TENANT_SCOPED_MODELS = [
  "MerchantUser",
  "AgentRule",
  "CheckoutSetting",
  "CheckoutSession",
  "CheckoutEvent",
  "BuyerIdentity",
  "MerchantRule",
  "SupportSetting",
  "SupportTicket",
  "AuthorizedOffer",
  "AcceptedOffer",
  "CompletedOrder",
  "MerchantApiKey",
  "MerchantWebhookEndpoint",
  "MerchantWebhookDelivery",
  "Shipment",
  "TrackingEvent",
  "ShippingQuote",
  "MerchantCommerceConnection",
  "MerchantOnboardingState",
  "MerchantPaymentConnection",
  "MerchantBillingSubscription",
  "MerchantInstallation",
  "MerchantAuditEvent",
  "CommercePendingOrder",
  "CommercePaidEvent",
  "BuyerPurchaseRecord",
  "MerchantNegotiationPolicy",
  "BuyerAgentNegotiationPreference",
  "NegotiationSession",
  "NegotiationCostLedgerEntry",
  "OutboxMessage",
  "CheckoutIntervention",
  "PaymentIntent",
  "PaymentProviderEvent",
  "HttpIdempotencyRecord",
  "Coupon",
  "CouponRedemption",
  "CrossSellPromotion",
  "CrossSellSuggestion",
  "PriceQuoteJob",
  "SelfCheckoutBuyerUser",
  "SelfCheckoutTemplate",
] as const;

export const TENANT_SCOPED_READ_OPERATIONS = [
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
] as const;

export const TENANT_SCOPED_WHERE_MUTATIONS = [
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
] as const;

export const TENANT_SCOPED_WRITE_OPERATIONS = [
  "create",
  "createMany",
  "createManyAndReturn",
  "upsert",
] as const;

const tenantScopedModelSet = new Set<string>(TENANT_SCOPED_MODELS);
const tenantReadOperationSet = new Set<string>(
  TENANT_SCOPED_READ_OPERATIONS,
);
const tenantWhereMutationSet = new Set<string>(
  TENANT_SCOPED_WHERE_MUTATIONS,
);
const tenantWriteOperationSet = new Set<string>(
  TENANT_SCOPED_WRITE_OPERATIONS,
);

export function shouldInjectTenant(model: string, operation: string): boolean {
  return (
    tenantScopedModelSet.has(model) &&
    (tenantReadOperationSet.has(operation) ||
      tenantWhereMutationSet.has(operation) ||
      tenantWriteOperationSet.has(operation))
  );
}

export function injectMerchantId(
  args: Record<string, unknown>,
  merchantId: string,
): Record<string, unknown> {
  assertMerchantId(merchantId);
  const where = isRecord(args.where) ? args.where : {};
  return {
    ...args,
    where: {
      ...where,
      merchantId,
    },
  };
}

export function injectMerchantIdIntoData(
  data: unknown,
  merchantId: string,
): Record<string, unknown> | Record<string, unknown>[] {
  assertMerchantId(merchantId);
  if (Array.isArray(data)) {
    return data.map((entry) => injectMerchantIdIntoDataObject(entry, merchantId));
  }
  return injectMerchantIdIntoDataObject(data, merchantId);
}

export function scopeTenantArgs(
  args: Record<string, unknown>,
  operation: string,
  merchantId: string,
): Record<string, unknown> {
  assertMerchantId(merchantId);

  if (tenantReadOperationSet.has(operation)) {
    return injectMerchantId(args, merchantId);
  }

  if (operation === "delete" || operation === "deleteMany") {
    return injectMerchantId(args, merchantId);
  }

  if (tenantWhereMutationSet.has(operation)) {
    return {
      ...injectMerchantId(args, merchantId),
      data: injectMerchantIdIntoData(args.data, merchantId),
    };
  }

  if (
    operation === "create" ||
    operation === "createMany" ||
    operation === "createManyAndReturn"
  ) {
    return {
      ...args,
      data: injectMerchantIdIntoData(args.data, merchantId),
    };
  }

  if (operation === "upsert") {
    return {
      ...injectMerchantId(args, merchantId),
      create: injectMerchantIdIntoDataObject(args.create, merchantId),
      update: injectMerchantIdIntoDataObject(args.update, merchantId),
    };
  }

  return { ...args };
}

export function scopeTenantOperation(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  context: TenantContext | null,
): Record<string, unknown> {
  if (!context || !shouldInjectTenant(model, operation)) return args;
  return scopeTenantArgs(args, operation, context.merchantId);
}

export function registerTenantMiddleware(
  prisma: PrismaClient,
  tenantCtx: TenantContextService,
) {
  return prisma.$extends({
    query: {
      $allModels: {
        // Prisma's extension callback is intentionally generic across all models.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          return query(
            scopeTenantOperation(
              model as string,
              operation as string,
              args as Record<string, unknown>,
              tenantCtx.get(),
            ),
          );
        },
      },
    },
  });
}

function injectMerchantIdIntoDataObject(
  data: unknown,
  merchantId: string,
): Record<string, unknown> {
  if (!isRecord(data)) {
    throw new TypeError("tenant_scope_requires_object_data");
  }
  return {
    ...data,
    merchantId,
  };
}

function assertMerchantId(merchantId: string): void {
  if (!merchantId.trim()) {
    throw new TypeError("tenant_scope_requires_merchant_id");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
