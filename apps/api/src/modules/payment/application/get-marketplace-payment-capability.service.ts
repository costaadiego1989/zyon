import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { hasMarketplaceCheckout } from "../../checkout/infrastructure/marketplace-checkout-scope.js";
import { BillingPlanMeteringService } from "../domain/billing-plan-guard.js";
import { PAYMENT_PROVIDER_PORT, type CreateProviderPaymentInput, type PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { PrepareMarketplaceCheckoutService } from "./prepare-marketplace-checkout.service.js";
import { assertMarketplacePublicPaymentCheckout, assertMarketplacePublicPaymentPolicy, assertMarketplacePublicPaymentRequest,
  marketplacePublicPaymentProfile, marketplacePublicPaymentProfileEnvironment, MarketplacePublicPaymentAdmissionError } from "./marketplace-public-payment-admission.service.js";

export interface MarketplacePaymentCapability {
  version: 1;
  session_id: string;
  marketplace: boolean;
  allowed: boolean;
  payment_methods: Array<"card" | "pix">;
  sandbox: boolean;
  reason: "marketplace_checkout_not_ready" | null;
}
type CapabilityReason = "available" | "not_marketplace" | "policy" | "checkout" | "existing_operation" | "internal_error";

/** A point-in-time presentation hint. A positive answer neither reserves stock
 * nor authorizes a charge; payment creation repeats its authoritative checks. */
@Injectable()
export class GetMarketplacePaymentCapabilityService {
  private readonly logger = new Logger(GetMarketplacePaymentCapabilityService.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    @Inject(MetricsService) private readonly metrics?: MetricsService) {}

  async execute(input: { merchantId: string; sessionId: string }): Promise<MarketplacePaymentCapability> {
    const blocked: MarketplacePaymentCapability = { version: 1, session_id: input.sessionId, marketplace: true,
      allowed: false, payment_methods: [], sandbox: false, reason: "marketplace_checkout_not_ready" };
    let reason: CapabilityReason = "checkout";
    try {
      const result = await this.prisma.$transaction(async tx => {
        // Must be the first command. Reused preflight code cannot accidentally
        // create a payment, freeze funding or reserve stock inside this preview.
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: input } });
        if (!session || session.merchantId !== input.merchantId || session.sessionId !== input.sessionId) return blocked;
        if (!await hasMarketplaceCheckout(tx, { ...input, session })) {
          reason = "not_marketplace";
          return { ...blocked, marketplace: false, reason: null };
        }
        reason = "policy";
        const profile = marketplacePublicPaymentProfile();
        const environment = marketplacePublicPaymentProfileEnvironment(profile);
        const candidates = (["card", "pix"] as const).filter(method => {
          try { assertMarketplacePublicPaymentRequest(input.merchantId, method); return true; } catch { return false; }
        });
        if (!candidates.length || !environment) return blocked;
        reason = "checkout";
        const cart = session.cart as { cart_ref?: unknown } | null;
        const refs = [...new Set([input.sessionId, ...(typeof cart?.cart_ref === "string" ? [cart.cart_ref] : [])])];
        if (await tx.marketplaceFundingPlan.findFirst({ where: { hostMerchantId: input.merchantId,
          OR: [{ checkoutSessionId: { in: refs } }, { payment: { sessionId: input.sessionId, merchantId: input.merchantId } }] }, select: { paymentIntentId: true } })) {
          reason = "existing_operation";
          return blocked;
        }
        // Both methods are local configuration checks in the marketplace route.
        // No create/recover/customer/refund API is invoked by this service.
        if (!this.provider.prepareMarketplaceAccount || !this.provider.preparePayment) return blocked;
        const reader = tx as PrismaClient;
        const prepare = new PrepareMarketplaceCheckoutService(reader, this.provider, new BillingPlanMeteringService(reader));
        const methods: MarketplacePaymentCapability["payment_methods"] = [];
        for (const method of candidates) {
          try {
        const funding = await prepare.execute({ ...input, method });
        const preview: CreateProviderPaymentInput = { ...input, intentId: "marketplace_capability_preview", method,
          provider: funding.provider, providerAccountFingerprint: funding.accountFingerprint,
          amountCents: funding.amountCents, currency: funding.currency, marketplaceFunding: funding,
          marketplacePublicAdmission: { version: 1, profile } };
        assertMarketplacePublicPaymentPolicy(preview);
        await assertMarketplacePublicPaymentCheckout(tx, preview);
        const configured = await this.provider.preparePayment(preview);
        assertMarketplacePublicPaymentPolicy(configured);
        // Recheck after all awaits so disabling the profile during the preview
        // cannot publish a positive hint from the former configuration.
        assertMarketplacePublicPaymentPolicy(preview);
        methods.push(method);
          } catch (error) {
            if (!(error instanceof MarketplacePublicPaymentAdmissionError || error instanceof HttpException && [400, 403, 409, 503].includes(error.getStatus()))) throw error;
          }
        }
        if (!methods.length || marketplacePublicPaymentProfile() !== profile) return blocked;
        reason = "available";
        return { ...blocked, allowed: true, payment_methods: methods, sandbox: environment === "test", reason: null };
      }, { isolationLevel: "RepeatableRead" });
      this.observe(result.allowed ? "available" : "unavailable", reason);
      return result;
    } catch (error) {
      const expected = error instanceof MarketplacePublicPaymentAdmissionError || error instanceof HttpException &&
        [400, 403, 409, 503].includes(error.getStatus());
      this.observe(expected ? "unavailable" : "error", expected ? reason : "internal_error");
      return blocked;
    }
  }

  private observe(outcome: "available" | "unavailable" | "error", reason: CapabilityReason): void {
    this.metrics?.marketplacePaymentCapabilityChecks.inc({ outcome, reason });
    this.logger.log({ event: "marketplace.payment_capability", outcome, reason });
  }
}
