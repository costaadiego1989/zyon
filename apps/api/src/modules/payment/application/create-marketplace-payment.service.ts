import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CheckoutSession } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { marketplacePaymentCartFingerprint, paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT, type CreateProviderPaymentInput, type PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { PaymentIntentEntity, type PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import { PaymentIntentConflictError } from "../domain/payment-persistence.js";
import { marketplacePaymentStatusInput } from "../domain/marketplace-payment-status.js";
import { assertPaymentAmount } from "../domain/payment-amount.js";
import { PrepareMarketplaceCheckoutService } from "./prepare-marketplace-checkout.service.js";
import { ResumePaymentCreationService } from "./resume-payment-creation.service.js";
import { OrderQuotaService } from "./services/order-quota.service.js";
import type { CreatePaymentIntentRequest, CreatePaymentIntentResponseBody } from "./create-payment-intent.use-case.js";
import { marketplacePublicPaymentProfile, MarketplacePublicPaymentAdmissionService } from "./marketplace-public-payment-admission.service.js";

/** Canonical orchestration. The public entry applies a separate explicit sandbox policy. */
@Injectable()
export class CreateMarketplacePaymentService {
  constructor(@Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkout: CheckoutSessionRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    private readonly prepare: PrepareMarketplaceCheckoutService,
    private readonly orderQuota: OrderQuotaService,
    @Inject(MarketplacePublicPaymentAdmissionService) private readonly publicAdmission?: MarketplacePublicPaymentAdmissionService) {}

  async execute(body: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponseBody> {
    return this.create(body, false);
  }

  async executePublic(body: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponseBody> {
    if (!this.publicAdmission) throw new ServiceUnavailableException("marketplace_checkout_not_ready");
    return this.create(body, true);
  }

  private async create(body: CreatePaymentIntentRequest, publiclyAdmitted: boolean): Promise<CreatePaymentIntentResponseBody> {
    const merchantId = body.merchant_id?.trim(), sessionId = body.session_id?.trim(), idempotencyKey = body.idempotency_key?.trim();
    if (!merchantId || !sessionId || !idempotencyKey) throw new BadRequestException("payment_intent_scope_invalid");
    if (body.credit_card) throw new BadRequestException("raw_card_forbidden");
    if (body.accepted_offer_id?.trim()) throw new BadRequestException("marketplace_offer_allocation_required");
    if (!["pix", "card"].includes(body.method ?? "pix")) throw new BadRequestException("marketplace_payment_method_invalid");
    const session = await this.checkout.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const existing = await this.payments.getByIdempotency(merchantId, sessionId, idempotencyKey);
    if (existing) return this.resume(existing, body, session, publiclyAdmitted);
    if (publiclyAdmitted) this.publicAdmission!.assertRequest(merchantId, body.method);
    if (!session.shipping) throw new BadRequestException("shipping_method_required_before_payment");
    await this.orderQuota.assertCanAcceptNewSales(merchantId);
    const method = (body.method ?? "pix") as "pix" | "card";
    const instructions = await this.prepare.execute({ merchantId, sessionId, method });
    const intent = PaymentIntentEntity.create({ merchantId, sessionId, idempotencyKey, method,
      amountCents: instructions.amountCents, currency: instructions.currency,
      amountBreakdown: { version: 1, currency: instructions.currency, cartFingerprint: paymentCartFingerprint(session),
        itemsSubtotalCents: instructions.lines.reduce((sum, line) => sum + line.grossAmountCents, 0), discountCents: 0,
        shippingCents: instructions.shipping.reduce((sum, row) => sum + row.amountCents, 0),
        platformFeeCents: instructions.buyerServiceFeeCents, totalCents: instructions.amountCents } });
    let input: CreateProviderPaymentInput = { merchantId, sessionId, intentId: intent.id, provider: instructions.provider,
      providerAccountFingerprint: instructions.accountFingerprint, marketplaceFunding: instructions,
      providerIdempotencyKey: createHash("sha256").update(`${merchantId}\0${sessionId}\0${idempotencyKey}`).digest("hex"),
      amountCents: instructions.amountCents, currency: instructions.currency, method,
      description: `${merchantId}:${sessionId}`,
      ...(publiclyAdmitted ? { marketplacePublicAdmission: { version: 1 as const, profile: marketplacePublicPaymentProfile() } } : {}) };
    if (publiclyAdmitted) {
      if (instructions.checkoutFingerprint !== marketplacePaymentCartFingerprint(session)) throw new ConflictException("marketplace_funding_checkout_changed");
      await this.publicAdmission!.assertNew(input);
    }
    if (!this.provider.preparePayment) throw new ConflictException("marketplace_capture_account_not_configured");
    input = await this.provider.preparePayment(input);
    if (instructions.provider === "asaas") {
      // Customer IDs belong to the account that created them. Neither the
      // merchant's cached ID nor a profile ID can authorize a platform charge.
      const customer = session.customer;
      if (!customer?.fullName?.trim() || !customer.email?.trim() || !customer.cpf?.trim()) throw new BadRequestException("asaas_customer_data_incomplete");
      if (!this.provider.createCustomer) throw new ConflictException("marketplace_customer_creation_not_configured");
      try {
        input.asaasCustomerId = await this.provider.createCustomer({ merchantId, marketplaceAccount: instructions,
          name: customer.fullName, email: customer.email, cpfCnpj: customer.cpf, phone: customer.phone ?? undefined });
        if (!input.asaasCustomerId?.trim()) throw new Error("customer_id_missing");
      } catch { throw new BadGatewayException("marketplace_customer_creation_failed"); }
    }
    input = await this.provider.preparePayment(input);
    intent.prepareCreation(input);
    // The marketplace allocation is frozen by the payment repository in this
    // transaction; the single-merchant settlement ledger does not apply here.
    try { await this.payments.saveIntent({ intent }); }
    catch (error) {
      if (!(error instanceof PaymentIntentConflictError)) throw error;
      const winner = await this.payments.getByIdempotency(merchantId, sessionId, idempotencyKey);
      if (!winner) throw new ConflictException("payment_creation_concurrent_change");
      return this.resume(winner, { ...body, method }, session, publiclyAdmitted);
    }
    return this.resume(intent, body, session, publiclyAdmitted);
  }

  private async resume(intent: PaymentIntentEntity, body: CreatePaymentIntentRequest, session: CheckoutSession, publiclyAdmitted = false) {
    const snapshot = intent.snapshot(), instructions = snapshot.creation?.input.marketplaceFunding;
    const locallyCancelled = snapshot.status === "cancelled" && snapshot.creation?.state === "ready" &&
      snapshot.providerPaymentId === undefined && snapshot.creation.firstAttemptAt === undefined;
    if (publiclyAdmitted) {
      const input = snapshot.creation?.input;
      if (!input || snapshot.merchantId !== body.merchant_id.trim() || snapshot.sessionId !== body.session_id.trim() ||
          input.merchantId !== snapshot.merchantId || input.sessionId !== snapshot.sessionId || input.intentId !== snapshot.id ||
          input.amountCents !== snapshot.amountCents || input.currency !== snapshot.currency || input.method !== snapshot.method) {
        throw new ServiceUnavailableException("marketplace_checkout_not_ready");
      }
      this.publicAdmission!.assertRecorded(input, body.method);
      if (snapshot.creation?.state === "ready" && !locallyCancelled) await this.publicAdmission!.assertNew(input);
    }
    if (!instructions?.checkoutFingerprint || !snapshot.amountBreakdown?.cartFingerprint) throw new ConflictException("marketplace_payment_identity_missing");
    if (locallyCancelled) {
      const input = snapshot.creation!.input;
      // A terminal, never-submitted operation retains its admitted identity.
      // Replaying it neither reopens a sale nor depends on today's cart/quote.
      if (snapshot.merchantId !== body.merchant_id.trim() || snapshot.sessionId !== body.session_id.trim() ||
          snapshot.idempotencyKey !== body.idempotency_key.trim() || session.merchantId !== snapshot.merchantId ||
          session.sessionId !== snapshot.sessionId || (body.method !== undefined && body.method !== snapshot.method) ||
          input.merchantId !== snapshot.merchantId || input.sessionId !== snapshot.sessionId || input.intentId !== snapshot.id ||
          input.amountCents !== snapshot.amountCents || input.currency !== snapshot.currency || input.method !== snapshot.method ||
          instructions.hostMerchantId !== snapshot.merchantId || instructions.provider !== input.provider ||
          !["stripe", "asaas"].includes(instructions.provider) || !["test", "live"].includes(instructions.environment) ||
          !/^[a-f0-9]{64}$/.test(instructions.accountFingerprint) || instructions.accountFingerprint !== input.providerAccountFingerprint ||
          snapshot.currency !== "BRL" || instructions.currency !== snapshot.currency ||
          instructions.amountCents !== snapshot.amountCents || snapshot.amountBreakdown.currency !== snapshot.currency ||
          snapshot.amountBreakdown.totalCents !== snapshot.amountCents || !Number.isSafeInteger(snapshot.amountCents) || snapshot.amountCents <= 0) {
        throw new ConflictException("payment_idempotency_input_mismatch");
      }
      assertPaymentAmount(snapshot.amountBreakdown, snapshot.amountCents, snapshot.currency);
      const { buyerFacing: _actions, ...status } = this.public(snapshot);
      return status;
    }
    if (session.cart.currentDiscount || session.cart.commercialNudge || session.cart.items.some(item =>
      item.selected_options !== undefined && (!Array.isArray(item.selected_options) || item.selected_options.length > 0)) ||
      (body.method && snapshot.method !== body.method) || snapshot.amountBreakdown.cartFingerprint !== paymentCartFingerprint(session) ||
      instructions.checkoutFingerprint !== marketplacePaymentCartFingerprint(session) ||
      instructions.hostStockItems?.some(item => !session.cart.items.some(row => !row.marketplace &&
        row.variantId === item.variantId && row.sku === item.sku && row.quantity === item.quantity)) ||
      instructions.lines.some(line => !session.cart.items.some(item => line.lineItemId === (item.marketplace?.lineItemId ?? `host:${item.sku}`) &&
        line.sellerMerchantId === (item.marketplace?.sourceMerchantId ?? session.merchantId)))) {
      throw new ConflictException("payment_idempotency_input_mismatch");
    }
    if (snapshot.creation?.state === "ready") {
      // A crash after admission but before the first POST must not revive an
      // expired carrier quote. Uncertain submissions retain their original
      // contract and continue through provider reconciliation only.
      await this.prepare.assertFrozenShipping({ merchantId: snapshot.merchantId, sessionId: snapshot.sessionId }, instructions);
    }
    const result = this.public(await new ResumePaymentCreationService(this.payments, this.provider).execute(intent));
    if (publiclyAdmitted && !await this.publicAdmission!.buyerInstructionsAllowed(snapshot.creation!.input)) {
      const { buyerFacing: _actions, ...status } = result;
      return status;
    }
    if (publiclyAdmitted && instructions.provider === "asaas" && snapshot.providerPaymentId) {
      const { buyerFacing: _cached, ...status } = result;
      if (!["pending", "requires_action"].includes(snapshot.status)) return status;
      try {
        const proof = marketplacePaymentStatusInput(snapshot);
        if (!proof || !this.provider.readMarketplacePaymentAction) return status;
        const remote = await this.provider.readMarketplacePaymentAction(proof);
        const fresh = (await this.payments.getIntentById(snapshot.merchantId, snapshot.id))?.snapshot();
        if (!fresh || fresh.version !== snapshot.version || fresh.status !== snapshot.status || fresh.providerPaymentId !== snapshot.providerPaymentId ||
          !isDeepStrictEqual(fresh.creation?.input, snapshot.creation?.input) || !await this.publicAdmission!.buyerInstructionsAllowed(fresh.creation!.input)) return status;
        if (remote.action?.kind === "asaas_pix" && snapshot.method === "pix") return { ...status, buyerFacing: {
          qrCodeCopyPaste: remote.action.copyPaste, encodedQrImage: remote.action.encodedImage, quoteExpiresAt: remote.action.expiresAt } };
        if (remote.action?.kind === "asaas_boleto" && snapshot.method === "boleto") return { ...status, buyerFacing: { invoiceUrl: remote.action.invoiceUrl } };
      } catch { /* Original instructions remain unavailable until the next proven GET. */ }
      return status;
    }
    return result;
  }

  private public(snapshot: PaymentIntentSnapshot): CreatePaymentIntentResponseBody {
    const { creation: _creation, version: _version, ...result } = snapshot;
    return result;
  }
}
