import { Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Cart, CheckoutSession } from "@zyon/shared-types";
import { isDeepStrictEqual } from "node:util";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { marketplacePaymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { assertMarketplaceShippingSelection } from "../../marketplace/infrastructure/repositories/marketplace-shipping-selection.js";
import type { CreateProviderPaymentInput } from "../domain/ports/payment-provider.port.js";

export const MARKETPLACE_PUBLIC_PAYMENT_PROFILE = "stripe_card_physical_sandbox_v1" as const;
export const MARKETPLACE_CONNECTED_SANDBOX_PROFILE = "connected_physical_sandbox_v2" as const;
export const MARKETPLACE_CONNECTED_LIVE_PROFILE = "connected_physical_live_v2" as const;
export type MarketplacePublicPaymentProfile = typeof MARKETPLACE_PUBLIC_PAYMENT_PROFILE | typeof MARKETPLACE_CONNECTED_SANDBOX_PROFILE |
  typeof MARKETPLACE_CONNECTED_LIVE_PROFILE;
export type MarketplacePublicPaymentAdmissionReason = "enabled" | "disabled" | "host_not_allowed" | "method_not_supported" |
  "identity_invalid" | "account_not_allowed" | "checkout_changed" | "physical_products_required" | "shipping_not_supported" | "existing_operation";
export class MarketplacePublicPaymentAdmissionError extends ServiceUnavailableException {
  constructor(readonly admissionReason: MarketplacePublicPaymentAdmissionReason) { super("marketplace_checkout_not_ready"); }
}
function refuse(reason: MarketplacePublicPaymentAdmissionReason): never { throw new MarketplacePublicPaymentAdmissionError(reason); }
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function marketplacePublicPaymentProfileEnvironment(profile: unknown): "test" | "live" | undefined {
  if (profile === MARKETPLACE_PUBLIC_PAYMENT_PROFILE || profile === MARKETPLACE_CONNECTED_SANDBOX_PROFILE) return "test";
  if (profile === MARKETPLACE_CONNECTED_LIVE_PROFILE) return "live";
  return undefined;
}

function accountFingerprint(profile: unknown, provider: unknown, env: NodeJS.ProcessEnv): string | undefined {
  const environment = marketplacePublicPaymentProfileEnvironment(profile);
  if (environment === "live") return provider === "stripe" ? env.MARKETPLACE_PUBLIC_PAYMENT_STRIPE_LIVE_ACCOUNT_FINGERPRINT :
    provider === "asaas" ? env.MARKETPLACE_PUBLIC_PAYMENT_ASAAS_LIVE_ACCOUNT_FINGERPRINT : undefined;
  if (environment === "test") return provider === "stripe" ? env.MARKETPLACE_PUBLIC_PAYMENT_STRIPE_TEST_ACCOUNT_FINGERPRINT :
    provider === "asaas" ? env.MARKETPLACE_PUBLIC_PAYMENT_ASAAS_TEST_ACCOUNT_FINGERPRINT : undefined;
  return undefined;
}

export function assertMarketplacePublicPaymentRequest(merchantId: string, method: unknown, env: NodeJS.ProcessEnv = process.env): void {
  const profile = env.MARKETPLACE_PUBLIC_PAYMENT_PROFILE;
  if (!marketplacePublicPaymentProfileEnvironment(profile)) refuse("disabled");
  const hosts = new Set((env.MARKETPLACE_PUBLIC_PAYMENT_HOSTS ?? "").split(",").map(value => value.trim()).filter(Boolean));
  if (!text(merchantId) || !hosts.has(merchantId)) refuse("host_not_allowed");
  const connected = profile === MARKETPLACE_CONNECTED_SANDBOX_PROFILE || profile === MARKETPLACE_CONNECTED_LIVE_PROFILE;
  if (method !== "card" && !(connected && method === "pix")) refuse("method_not_supported");
  const fingerprint = accountFingerprint(profile, method === "card" ? "stripe" : "asaas", env);
  if (!/^[a-f0-9]{64}$/.test(fingerprint ?? "")) refuse("account_not_allowed");
}

export function marketplacePublicPaymentProfile(): MarketplacePublicPaymentProfile {
  return process.env.MARKETPLACE_PUBLIC_PAYMENT_PROFILE as MarketplacePublicPaymentProfile;
}

/** Checks only the immutable identity; disabling new sales must not prevent read-only reconciliation. */
export function assertRecordedMarketplacePublicPayment(input: CreateProviderPaymentInput): void {
  const marker = input.marketplacePublicAdmission, funding = input.marketplaceFunding;
  const environment = marketplacePublicPaymentProfileEnvironment(marker?.profile);
  const supported = marker?.profile === MARKETPLACE_PUBLIC_PAYMENT_PROFILE ? input.provider === "stripe" && input.method === "card" :
    marker?.profile === MARKETPLACE_CONNECTED_SANDBOX_PROFILE ? input.provider === "stripe" && input.method === "card" || input.provider === "asaas" && ["pix", "boleto"].includes(input.method) :
    marker?.profile === MARKETPLACE_CONNECTED_LIVE_PROFILE && (input.provider === "stripe" && input.method === "card" || input.provider === "asaas" && input.method === "pix");
  if (marker?.version !== 1 || !environment || !supported || !funding ||
      funding.provider !== input.provider || funding.environment !== environment ||
      !text(input.merchantId) || !text(input.sessionId) || !text(input.intentId) || funding.hostMerchantId !== input.merchantId ||
      !/^[a-f0-9]{64}$/.test(funding.accountFingerprint) || input.providerAccountFingerprint !== funding.accountFingerprint ||
      input.currency !== "BRL" || funding.currency !== input.currency || funding.amountCents !== input.amountCents ||
      !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || !text(funding.checkoutFingerprint) ||
      input.settlementMode || input.stripeConnectAccountId || input.merchantPayoutDestination || input.merchantPayoutHoldDays !== undefined ||
      (input.platformFeeCents ?? 0) !== 0 || input.creditCard || input.creditCardHolderInfo || !Array.isArray(funding.shippingQuotes) ||
      !funding.shippingQuotes.length || !Array.isArray(funding.shipping) || !funding.shipping.length) refuse("identity_invalid");
}

/** Shared with the durable repository on insertion and the first-send transition. */
export function assertMarketplacePublicPaymentPolicy(input: CreateProviderPaymentInput, env: NodeJS.ProcessEnv = process.env): void {
  assertMarketplacePublicPaymentRequest(input.merchantId, input.method, env);
  assertRecordedMarketplacePublicPayment(input);
  if (input.marketplacePublicAdmission!.profile !== env.MARKETPLACE_PUBLIC_PAYMENT_PROFILE) refuse("disabled");
  const allowedFingerprint = accountFingerprint(input.marketplacePublicAdmission!.profile, input.provider, env);
  if (input.marketplaceFunding!.accountFingerprint !== allowedFingerprint) refuse("account_not_allowed");
}

/** Read using the caller's transaction after its checkout/cart locks. No provider or carrier calls. */
export async function assertMarketplacePublicPaymentCheckout(reader: Prisma.TransactionClient, input: CreateProviderPaymentInput): Promise<void> {
  const row = await reader.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: input.sessionId } } });
  if (!row || row.merchantId !== input.merchantId || row.sessionId !== input.sessionId) refuse("checkout_changed");
  const funding = input.marketplaceFunding;
  const environment = marketplacePublicPaymentProfileEnvironment(input.marketplacePublicAdmission?.profile);
  const session = { cart: row.cart as unknown as Cart, shipping: row.shipping as unknown as CheckoutSession["shipping"],
    customer: row.customer as unknown as CheckoutSession["customer"] };
  if (!funding || !environment || funding.environment !== environment || !Array.isArray(session.cart?.items) || !session.cart.items.length ||
      funding.checkoutFingerprint !== marketplacePaymentCartFingerprint(session)) refuse("checkout_changed");
  if (input.provider === "asaas") {
    const cartRef = (session.cart as Cart & { cart_ref?: string }).cart_ref;
    if (await reader.marketplaceCancellationOperation.findFirst({ where: { hostMerchantId: input.merchantId,
      status: { in: ["planned", "unknown", "blocked"] }, fundingPlan: { OR: [
        { checkoutSessionId: { in: [...new Set([input.sessionId, ...(text(cartRef) ? [cartRef] : [])])] } },
        { payment: { sessionId: input.sessionId, merchantId: input.merchantId } },
      ] } }, select: { id: true } })) refuse("existing_operation");
  }
  const variants = await reader.productVariant.findMany({ where: { id: { in: session.cart.items.map(item => item.variantId ?? "") } }, include: { product: true } });
  if (variants.length !== new Set(session.cart.items.map(item => item.variantId)).size || session.cart.items.some(item => {
    const variant = variants.find(candidate => candidate.id === item.variantId);
    return !variant?.isActive || !variant.product.isActive || variant.product.deletedAt || variant.product.type !== "physical" ||
      variant.product.merchantId !== (item.marketplace?.sourceMerchantId ?? input.merchantId) || variant.sku !== item.sku;
  })) refuse("physical_products_required");
  try {
    const shipping = await assertMarketplaceShippingSelection(reader, { merchantId: input.merchantId, sessionId: input.sessionId, ...session });
    if (!shipping.quotes.length || !isDeepStrictEqual(shipping.quotes, funding.shippingQuotes) ||
        !isDeepStrictEqual(shipping.allocations, funding.shipping)) refuse("shipping_not_supported");
    for (const binding of shipping.quotes) {
      const quote = await reader.shippingQuote.findFirst({ where: { id: binding.quoteId, merchantId: input.merchantId } });
      const results = quote?.results as Array<{ carrier_key?: string; marketplaceCarrierQuote?: { environment?: string } }> | undefined;
      if (!Array.isArray(results) || results.find(result => result.carrier_key === binding.carrierKey)?.marketplaceCarrierQuote?.environment !== environment) {
        refuse("shipping_not_supported");
      }
    }
  } catch { refuse("shipping_not_supported"); }
}

@Injectable()
export class MarketplacePublicPaymentAdmissionService {
  private readonly logger = new Logger(MarketplacePublicPaymentAdmissionService.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(MetricsService) private readonly metrics?: MetricsService) {}

  assertRequest(merchantId: string, method: unknown): void {
    try { assertMarketplacePublicPaymentRequest(merchantId, method, process.env); }
    catch (error) { this.rejected(merchantId, error); }
  }

  async assertNew(input: CreateProviderPaymentInput): Promise<void> {
    try {
      assertMarketplacePublicPaymentPolicy(input);
      await assertMarketplacePublicPaymentCheckout(this.prisma, input);
      this.decision("admitted", "enabled", input.merchantId);
    } catch (error) { this.rejected(input.merchantId, error); }
  }

  assertRecorded(input: CreateProviderPaymentInput, requestedMethod: unknown): void {
    try {
      if (requestedMethod !== input.method) refuse("method_not_supported");
      assertRecordedMarketplacePublicPayment(input);
    } catch (error) { this.rejected(input.merchantId, error); }
  }

  actionsAllowed(input: CreateProviderPaymentInput): boolean {
    try { assertMarketplacePublicPaymentPolicy(input); return true; }
    catch { this.decision("reconcile_only", "existing_operation", input.merchantId); return false; }
  }

  async buyerInstructionsAllowed(input: CreateProviderPaymentInput): Promise<boolean> {
    if (!this.actionsAllowed(input)) return false;
    if (input.provider !== "asaas") return true;
    try {
      return !await this.prisma.marketplaceCancellationOperation.findFirst({ where: { fundingPlanId: input.intentId,
        hostMerchantId: input.merchantId, status: { in: ["planned", "unknown", "blocked"] } }, select: { id: true } });
    } catch { return false; }
  }

  private rejected(merchantId: string, error: unknown): never {
    const refusal = error instanceof MarketplacePublicPaymentAdmissionError ? error : new MarketplacePublicPaymentAdmissionError("identity_invalid");
    this.decision("refused", refusal.admissionReason, merchantId);
    throw refusal;
  }

  private decision(outcome: "admitted" | "refused" | "reconcile_only", reason: MarketplacePublicPaymentAdmissionReason, merchantId: string): void {
    this.logger.log({ event: "marketplace.public_payment_admission", outcome, reason, merchant_id: merchantId });
    this.metrics?.marketplacePublicPaymentAdmission.inc({ outcome, reason });
  }
}
