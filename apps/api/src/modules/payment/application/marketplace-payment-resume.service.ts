import { ConflictException, ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { MarketplaceFundingPlan, PrismaClient } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { assertFrozenMarketplacePaymentIdentity } from "../domain/frozen-marketplace-payment-identity.js";
import { marketplacePaymentStatusInput } from "../domain/marketplace-payment-status.js";
import { isMarketplacePaymentResumeBinding, type MarketplacePaymentResumeBinding, type MarketplacePaymentActionReason,
  type MarketplacePaymentProviderStatus } from "../domain/marketplace-payment-resume.js";
import type { PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import { PAYMENT_PROVIDER_PORT, type PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { PrismaPaymentRepository } from "../infrastructure/prisma-payment.repository.js";
import { assertRecordedMarketplacePublicPayment, MarketplacePublicPaymentAdmissionService } from "./marketplace-public-payment-admission.service.js";
import { ConfirmStripePaymentUseCase } from "./confirm-stripe-payment.use-case.js";

export type MarketplacePaymentResumeScope = { merchantId: string; sessionId: string; cartRef: string };
export type AuthorizedMarketplacePaymentResume = MarketplacePaymentResumeScope & {
  binding: MarketplacePaymentResumeBinding; expiresAtUnix: number;
};
export interface MarketplacePaymentActionResponse {
  version: 1;
  session_id: string;
  intent_id: string;
  amount_cents: number;
  currency: "BRL";
  method: "card" | "pix" | "boleto";
  provider_status: MarketplacePaymentProviderStatus;
  observed_at: string;
  action: null | { kind: "stripe_card_entry" | "stripe_card_3ds"; client_secret: string; publishable_key: string; valid_until: string }
    | { kind: "asaas_pix"; pix_code: string; pix_qr_image?: string; expires_at: string; valid_until: string }
    | { kind: "asaas_boleto"; invoice_url: string; valid_until: string };
  reason: MarketplacePaymentActionReason | null;
}
type FrozenOperation = { snapshot: PaymentIntentSnapshot; plan: MarketplaceFundingPlan; binding: MarketplacePaymentResumeBinding };
class ResumeBlocked extends Error {}
const identifier = (value: unknown): value is string => typeof value === "string" &&
  value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value);
const terminal = (snapshot: PaymentIntentSnapshot) => !["pending", "requires_action"].includes(snapshot.status);

/** Restores a buyer action only for an already-created charge in its original admitted environment.
 * No checkout locks span provider I/O; this service never resumes creation. */
@Injectable()
export class MarketplacePaymentResumeService {
  private readonly logger = new Logger(MarketplacePaymentResumeService.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    @Inject(MarketplacePublicPaymentAdmissionService) private readonly admission: MarketplacePublicPaymentAdmissionService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(ConfirmStripePaymentUseCase) private readonly confirmation: ConfirmStripePaymentUseCase) {}

  /** Called only after the continuation issuer verifies cart/buyer/previous-token ownership. */
  async authorize(scope: MarketplacePaymentResumeScope): Promise<MarketplacePaymentResumeBinding> {
    return this.operation("authorize", async () => {
      const frozen = await this.readFrozen(scope);
      return frozen.binding;
    });
  }

  async read(input: AuthorizedMarketplacePaymentResume): Promise<MarketplacePaymentActionResponse> {
    return this.operation("read", async () => {
      this.assertAuthorization(input);
      const before = await this.readFrozen(input);
      this.assertPin(input, before);
      const response = (providerStatus: MarketplacePaymentProviderStatus, action: MarketplacePaymentActionResponse["action"],
        reason: MarketplacePaymentActionReason | null): MarketplacePaymentActionResponse => ({
        version: 1, session_id: input.sessionId, intent_id: before.snapshot.id, amount_cents: before.snapshot.amountCents,
        currency: "BRL", method: before.binding.method, provider_status: providerStatus, observed_at: new Date().toISOString(), action, reason,
      });
      if (terminal(before.snapshot)) return response("unknown", null, "payment_terminal");
      if (!this.admission.actionsAllowed(before.snapshot.creation!.input)) return response("unknown", null, "observation_only");
      const proof = marketplacePaymentStatusInput(before.snapshot);
      if (!proof || !this.provider.readMarketplacePaymentAction) throw new Error("reader_unavailable");
      const remote = await this.provider.readMarketplacePaymentAction(proof);
      // Discard late results and changed/terminal operations before exposing credentials.
      this.assertAuthorization(input);
      const after = await this.readFrozen(input);
      this.assertPin(input, after);
      this.assertAuthorization(input);
      if (terminal(after.snapshot)) return response(remote.providerStatus, null, "payment_terminal");
      if (before.snapshot.version !== after.snapshot.version || before.snapshot.status !== after.snapshot.status) throw new ResumeBlocked();
      if (!this.admission.actionsAllowed(after.snapshot.creation!.input)) return response(remote.providerStatus, null, "observation_only");
      if (!remote.action) return response(remote.providerStatus, null, remote.reason ?? "payment_action_unavailable");
      const valid_until = new Date(input.expiresAtUnix * 1000).toISOString();
      if (before.binding.provider === "asaas") {
        if (remote.providerStatus !== "requires_action") throw new ResumeBlocked();
        if (remote.action.kind === "asaas_pix" && before.binding.method === "pix" && remote.action.copyPaste.trim() &&
          remote.action.copyPaste.length <= 4096 && !/[\u0000-\u001f]/.test(remote.action.copyPaste) && Number.isFinite(Date.parse(remote.action.expiresAt)) &&
          Date.parse(remote.action.expiresAt) > Date.now()) return response(remote.providerStatus, { kind: "asaas_pix", pix_code: remote.action.copyPaste,
            ...(remote.action.encodedImage ? { pix_qr_image: remote.action.encodedImage } : {}), expires_at: remote.action.expiresAt, valid_until }, null);
        if (remote.action.kind === "asaas_boleto" && before.binding.method === "boleto" && before.binding.environment === "test" &&
          /^https:\/\/sandbox\.asaas\.com\/i\/[A-Za-z0-9_-]+$/.test(remote.action.invoiceUrl)) {
          return response(remote.providerStatus, { kind: "asaas_boleto", invoice_url: remote.action.invoiceUrl, valid_until }, null);
        }
        throw new ResumeBlocked();
      }
      if (remote.action.kind === "asaas_pix" || remote.action.kind === "asaas_boleto") throw new ResumeBlocked();
      if (!["stripe_card_entry", "stripe_card_3ds"].includes(remote.action.kind) ||
        remote.action.kind === "stripe_card_entry" && remote.providerStatus !== "requires_payment_method" ||
        remote.action.kind === "stripe_card_3ds" && remote.providerStatus !== "requires_action" ||
        !remote.action.clientSecret.startsWith(`${before.binding.providerPaymentId}_secret_`) ||
        remote.action.clientSecret.length > 500 || !/^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(remote.action.clientSecret) ||
        !/^pk_(test|live)_[A-Za-z0-9]+$/.test(remote.action.publishableKey) ||
        !remote.action.publishableKey.startsWith(`pk_${before.binding.environment}_`) || remote.action.publishableKey.length > 500) throw new ResumeBlocked();
      return response(remote.providerStatus, { kind: remote.action.kind, client_secret: remote.action.clientSecret,
        publishable_key: remote.action.publishableKey, valid_until: new Date(input.expiresAtUnix * 1000).toISOString() }, null);
    }, result => result.action === null ? "blocked" : "success");
  }

  async confirm(input: AuthorizedMarketplacePaymentResume): Promise<{ status: string; intent_id: string }> {
    return this.operation("confirm", async () => {
      this.assertAuthorization(input);
      const frozen = await this.readFrozen(input);
      if (frozen.binding.provider !== "stripe") throw new ResumeBlocked();
      this.assertPin(input, frozen);
      this.assertAuthorization(input);
      if (!["requires_action", "approved"].includes(frozen.snapshot.status)) throw new ResumeBlocked();
      // This existing verifier retrieves the original PI, proves captured amount/account,
      // and commits approval + outbox atomically. It never confirms a card or creates a PI.
      return this.confirmation.execute({ merchant_id: input.merchantId, session_id: input.sessionId, intent_id: frozen.snapshot.id });
    });
  }

  private assertAuthorization(input: AuthorizedMarketplacePaymentResume): void {
    const now = Math.floor(Date.now() / 1000);
    if (!isMarketplacePaymentResumeBinding(input.binding) || !Number.isSafeInteger(input.expiresAtUnix) ||
      input.expiresAtUnix <= now || input.expiresAtUnix > now + 300 || input.binding.sessionId !== input.sessionId) throw new ResumeBlocked();
  }

  private assertPin(input: AuthorizedMarketplacePaymentResume, frozen: FrozenOperation): void {
    if (!isDeepStrictEqual(input.binding, frozen.binding)) throw new ResumeBlocked();
  }

  private async readFrozen(scope: MarketplacePaymentResumeScope): Promise<FrozenOperation> {
    if (!identifier(scope.merchantId) || !identifier(scope.sessionId) || !identifier(scope.cartRef)) throw new ResumeBlocked();
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: {
        merchantId: scope.merchantId, sessionId: scope.sessionId,
      } } });
      const cart = session?.cart as { cart_ref?: unknown } | undefined;
      if (!session || session.merchantId !== scope.merchantId || session.sessionId !== scope.sessionId || cart?.cart_ref !== scope.cartRef) throw new ResumeBlocked();
      const rows = await tx.paymentIntent.findMany({ where: { merchantId: scope.merchantId, sessionId: scope.sessionId }, select: { id: true }, take: 2 });
      const plans = await tx.marketplaceFundingPlan.findMany({ where: { OR: [
        { payment: { merchantId: scope.merchantId, sessionId: scope.sessionId } },
        { hostMerchantId: scope.merchantId, checkoutSessionId: { in: [...new Set([scope.sessionId, scope.cartRef])] } },
      ] }, take: 2 });
      if (rows.length !== 1 || plans.length !== 1) throw new ResumeBlocked();
      const snapshot = (await new PrismaPaymentRepository(tx as PrismaClient).getIntentById(scope.merchantId, rows[0]!.id))?.snapshot();
      const plan = plans[0]!;
      try {
        if (!snapshot || snapshot.merchantId !== scope.merchantId || snapshot.sessionId !== scope.sessionId ||
          snapshot.creation?.state !== "complete" || !snapshot.providerPaymentId ||
          !["test", "live"].includes(plan.environment) || !(plan.provider === "stripe" && snapshot.method === "card" ||
            plan.provider === "asaas" && (snapshot.method === "pix" || snapshot.method === "boleto" && plan.environment === "test"))) throw new ResumeBlocked();
        if (plan.provider === "asaas" && await tx.marketplaceCancellationOperation.findFirst({ where: {
          fundingPlanId: snapshot.id, hostMerchantId: scope.merchantId, status: { in: ["planned", "unknown", "blocked"] },
        }, select: { id: true } })) throw new ResumeBlocked();
        assertFrozenMarketplacePaymentIdentity(snapshot, plan, scope.cartRef);
        assertRecordedMarketplacePublicPayment(snapshot.creation.input);
        const funding = snapshot.creation.input.marketplaceFunding!;
        const binding: MarketplacePaymentResumeBinding = { version: 1, sessionId: scope.sessionId, intentId: snapshot.id,
          providerPaymentId: snapshot.providerPaymentId, provider: plan.provider as "stripe" | "asaas", environment: funding.environment, accountFingerprint: plan.accountFingerprint,
          fundingInstructionsHash: plan.instructionsHash, checkoutFingerprint: funding.checkoutFingerprint!, method: snapshot.method as "card" | "pix" | "boleto",
          amountCents: snapshot.amountCents, currency: "BRL" };
        if (!isMarketplacePaymentResumeBinding(binding)) throw new ResumeBlocked();
        return { snapshot, plan, binding };
      } catch { throw new ResumeBlocked(); }
    }, { isolationLevel: "RepeatableRead" });
  }

  private async operation<T>(operation: "authorize" | "read" | "confirm", work: () => Promise<T>,
    outcome: (result: T) => "success" | "blocked" = () => "success"): Promise<T> {
    try {
      const result = await work(); this.observe(operation, outcome(result)); return result;
    } catch (error) {
      const blocked = error instanceof ResumeBlocked || error instanceof ForbiddenException ||
        error instanceof ConflictException || (typeof (error as { getStatus?: unknown })?.getStatus === "function" &&
          (error as { getStatus: () => number }).getStatus() >= 400 && (error as { getStatus: () => number }).getStatus() < 500);
      this.observe(operation, blocked ? "blocked" : "error");
      if (blocked) throw new ConflictException("marketplace_payment_resume_unavailable");
      throw new ServiceUnavailableException("marketplace_payment_resume_unavailable");
    }
  }

  private observe(operation: "authorize" | "read" | "confirm", outcome: "success" | "blocked" | "error"): void {
    try { this.metrics.marketplacePaymentResumeOperations.inc({ operation, outcome }); } catch { /* Telemetry cannot change financial semantics. */ }
    try { this.logger.log({ event: "marketplace.payment_resume", operation, outcome, correlationId: CorrelationIdStorage.get() }); }
    catch { /* A logging sink cannot change approval or read results either. */ }
  }
}
