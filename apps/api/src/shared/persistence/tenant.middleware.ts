import type { PrismaClient } from "@prisma/client";
import type {
  TenantContext,
  TenantContextService,
} from "../tenant/tenant-context.service.js";
export type { TenantContext } from "../tenant/tenant-context.service.js";

// Every Prisma model carrying a `merchantId` scalar. Kept in sync with
// prisma/schema.prisma by tenant.middleware.spec ("keeps the tenant model list
// aligned"). All of these are tenant-scoped: reads are filtered, writes stamped,
// and where-mutations pinned to the caller's merchant. Composite-key targeting
// is handled by injectMerchantId (pins the tenant inside the compound object).
export const TENANT_SCOPED_MODELS = [
  "AcceptedOffer",
  "AgentRule",
  "AttributionTag",
  "AuthorizedOffer",
  "BudgetRequest",
  "BuyerAgent",
  "BuyerAgentNegotiationPreference",
  "BuyerConversation",
  "BuyerEarnedBenefit",
  "BuyerIdentity",
  "BuyerIntentMemoryConsent",
  "BuyerLoyaltyTracker",
  "BuyerPurchaseRecord",
  "CartRecoveryStrategyPref",
  "CheckoutEvent",
  "CheckoutIntervention",
  "CheckoutSession",
  "CheckoutSetting",
  "CommercePaidEvent",
  "CommercePendingOrder",
  "CompletedOrder",
  "Coupon",
  "CouponRedemption",
  "CrmConnection",
  "CrmSyncLog",
  "CrossSellPromotion",
  "CrossSellSuggestion",
  "CustomerIntentRecord",
  "ErpConnection",
  "HoldoutGroupAssignment",
  "HttpIdempotencyRecord",
  "ImportJob",
  "InventoryAlert",
  "InventoryItem",
  "InventoryLocation",
  "InventoryMovement",
  "KnowledgeChunk",
  "M2MProtocolConfig",
  "MarketplaceConfig",
  "MerchantApiKey",
  "MerchantAuditEvent",
  "MerchantBillingSubscription",
  "MerchantCommerceConnection",
  "MerchantDomain",
  "MerchantInstallation",
  "MerchantInvite",
  "MerchantNegotiationPolicy",
  "MerchantNotification",
  "MerchantOnboardingState",
  "MerchantPaymentConnection",
  "MerchantPolicy",
  "MerchantRule",
  "MerchantTeamMember",
  "MerchantUser",
  "MerchantWebhookDelivery",
  "MerchantWebhookEndpoint",
  "NegotiationAttempt",
  "NegotiationCostLedgerEntry",
  "NegotiationSession",
  "NpsResponse",
  "OutboxMessage",
  "OwnDeliveryConfig",
  "PaymentCryptoTransfer",
  "PaymentHold",
  "PaymentIntent",
  "PaymentProviderEvent",
  "PostSaleMessageTemplate",
  "PostSaleScheduledMessage",
  "PriceQuoteJob",
  "Product",
  "ProductCategory",
  "ProductCollection",
  "ProductPromotion",
  "ProductReview",
  "ProductSearchVector",
  "PromptExperiment",
  "ProtocolSession",
  "RecoveryAttempt",
  "Return",
  "RevenueLiftSnapshot",
  "RevenueManagerHypothesis",
  "RevenueManagerObservation",
  "RevenueManagerStrategyLesson",
  "SelfCheckoutBuyerUser",
  "SelfCheckoutTemplate",
  "Shipment",
  "ShippingQuote",
  "StoreMetricDaily",
  "StoreProductMetric",
  "StorefrontCart",
  "Story",
  "StoryCategory",
  "SupportSetting",
  "SupportTicket",
  "TrackingEvent",
  "WhatsAppChannelConfig",
  "WhatsAppSession",
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

  // Composite-unique targeting: Prisma names compound keys `merchantId_<...>`
  // and expects the identifier as a single nested object, with NO sibling
  // scalar fields in `where`. For those, adding a top-level `merchantId` makes
  // the args invalid. Instead, pin the tenant inside the composite object so
  // isolation is still enforced (and a hostile merchantId is overwritten).
  const compositeKey = Object.keys(where).find(
    (k) => k.startsWith("merchantId_") && isRecord((where as Record<string, unknown>)[k]),
  );
  if (compositeKey) {
    const composite = where[compositeKey] as Record<string, unknown>;
    return {
      ...args,
      where: {
        ...where,
        [compositeKey]: { ...composite, merchantId },
      },
    };
  }

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
