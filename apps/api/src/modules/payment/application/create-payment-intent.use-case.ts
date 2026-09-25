import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
, Logger} from "@nestjs/common";
import { createHash } from "node:crypto";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { ResumePaymentCreationService } from "./resume-payment-creation.service.js";
import { PaymentIntentConflictError } from "../domain/payment-persistence.js";
import { isPaymentCreationRejectionCode, PaymentCreationRejectedError } from "../domain/payment-creation-rejected.error.js";
import type { PaymentAmountBreakdown } from "../domain/payment-amount.js";
import { PaymentIntentEntity, type PaymentIntentSnapshot, type PaymentMethod } from "../domain/payment-intent.entity.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { OFFER_REPOSITORY, type OfferRepository } from "../../checkout/domain/ports/offer.repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository
} from "../domain/ports/payment-repository.port.js";
import type { CreateProviderPaymentInput, CreateProviderPaymentOutput, PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { PAYMENT_PROVIDER_PORT } from "../domain/ports/payment-provider.port.js";
import type { CheckoutSession, CurrencyCode } from "@zyon/shared-types";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { isStripeConfigured, readBuyerServiceFeeCents } from "../infrastructure/stripe-env.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import { CHECKOUT_PAYMENT_PORT, type CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { ValidateCartForPaymentUseCase } from "../../commerce/application/validate-cart-for-payment.use-case.js";
import { SyncPendingOrderUseCase } from "../../commerce/application/sync-pending-order.use-case.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../domain/ports/payment-platform-repository.port.js";
import { BillingPlanMeteringService } from "../domain/billing-plan-guard.js";
import { OrderQuotaService } from "./services/order-quota.service.js";
import { assertProviderFeeCap, merchantTransactionFeeCentsFor } from "../domain/billing-plans.js";
import type { PlannedPaymentSettlement } from "../domain/ports/payment-settlement-ledger.port.js";
import { resolveCheckoutPaymentCapabilities } from "../domain/checkout-payment-routing.js";

export type CreatePaymentIntentRequest = {
  merchant_id: string;
  session_id: string;
  idempotency_key: string;
  method?: PaymentMethod;
  accepted_offer_id?: string;
  /**
   * Crypto-only: buyer-selected chain (e.g. "polygon" or "base"). Harmless for
   * non-crypto methods. Threaded into the crypto provider so the buyer-driven
   * selection in the widget survives to the quote that renders the wallet.
   */
  preferred_chain?: "polygon" | "base";
  credit_card?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  remote_ip?: string;
};

export type CreatePaymentIntentResponseBody = Omit<PaymentIntentSnapshot, "creation" | "version">;

function publicPayment(snapshot: PaymentIntentSnapshot): CreatePaymentIntentResponseBody {
  const rejection = snapshot.creation?.reason;
  if (snapshot.status === "failed" && isPaymentCreationRejectionCode(rejection)) {
    throw new ConflictException(rejection);
  }
  if (snapshot.status === "pending" && !snapshot.providerPaymentId) {
    throw new BadGatewayException("payment_creation_uncertain");
  }
  if (snapshot.method === "pix" && snapshot.status === "requires_action" &&
    !snapshot.buyerFacing?.qrCodeCopyPaste?.trim()) {
    throw new BadGatewayException("payment_creation_uncertain");
  }
  const { creation: _creation, version: _version, ...publicFields } = snapshot;
  return publicFields;
}

function delayedMerchantPayoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.PAYMENT_MERCHANT_SETTLEMENT_MODE?.trim();
  if (!mode || mode === "immediate_split") return false;
  if (mode === "delayed_merchant_payout") {
    if (env.PAYMENT_MERCHANT_DELAYED_PAYOUT_ASAAS_ENABLED?.trim() !== "true") {
      // An explicit second gate prevents a configuration typo from retaining
      // merchant funds before the Asaas transfer integration is validated.
      throw new BadRequestException("delayed_merchant_payout_asaas_not_enabled");
    }
    return true;
  }
  throw new BadRequestException("payment_merchant_settlement_mode_invalid");
}

function delayedMerchantPayoutHoldDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PAYMENT_MERCHANT_PAYOUT_HOLD_DAYS?.trim();
  if (!raw) return 14;
  if (!/^\d+$/.test(raw)) throw new BadRequestException("payment_hold_window_invalid");
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw new BadRequestException("payment_hold_window_invalid");
  return days;
}

function assertSameRequest(snapshot: PaymentIntentSnapshot, body: CreatePaymentIntentRequest, session: CheckoutSession): void {
  if ((body.method && body.method !== snapshot.method) ||
    normalizeAcceptedOfferId(body) !== snapshot.acceptedOfferId ||
    (snapshot.amountBreakdown?.cartFingerprint && snapshot.amountBreakdown.cartFingerprint !== paymentCartFingerprint(session))) {
    throw new ConflictException("payment_idempotency_input_mismatch");
  }
  if (!snapshot.amountBreakdown?.cartFingerprint && snapshot.status === "pending" && !snapshot.providerPaymentId) {
    throw new ConflictException("payment_creation_manual_review_required");
  }
}

function resolveAsaasCustomerIdFromSession(session: CheckoutSession): string | undefined {
  const cid = session.customer?.asaasCustomerId;
  const trimmed = typeof cid === "string" ? cid.trim() : "";
  return trimmed || undefined;
}

function resolveAsaasCustomerForProvider(asaasCustomer: string | undefined): string {
  const resolved = asaasCustomer?.trim();
  if (resolved) return resolved;
  throw new BadRequestException("asaas_customer_id_missing_on_buyer_session");
}

function assertCheckoutReadyForPayment(session: CheckoutSession): void {
  if (session.cart.items.length > 0 && !session.shipping) {
    throw new BadRequestException("shipping_method_required_before_payment");
  }
}

function normalizeAcceptedOfferId(input: CreatePaymentIntentRequest): string | undefined {
  return typeof input.accepted_offer_id === "string"
    ? input.accepted_offer_id.trim() || undefined
    : undefined;
}

function commerceCartRefFrom(session: CheckoutSession): string | undefined {
  const ref = session.cart.commerceCartRef?.trim();
  return ref || undefined;
}

function paymentDescription(storeName: string | undefined, session: CheckoutSession): string {
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const store = clean(storeName ?? "") || "Loja";
  const items = session.cart.items.map(item => `${item.quantity}x ${clean(item.name) || "Produto"}`).join(", ");
  return `${store} — ${items || "Compra na loja"}`.slice(0, 256);
}

/**
 * Stable provider idempotency key from the local idempotency tuple. Survives
 * client retries (the local intent id is random per attempt), so the provider
 * dedupes a re-issued charge instead of creating a second live charge
 * (ADR 0001 #6).
 */
function deriveProviderIdempotencyKey(merchantId: string, sessionId: string, idempotencyKey: string): string {
  return createHash("sha256").update(`${merchantId}\0${sessionId}\0${idempotencyKey}`).digest("hex");
}

function plannedProviderName(input: { provider?: string }, method: PaymentMethod, options: {
  isStripeCard: boolean;
  usesMercadoPago: boolean;
}): string {
  if (input.provider?.trim()) return input.provider.trim();
  if (method === "crypto") return "crypto";
  if (options.isStripeCard) return "stripe";
  if (options.usesMercadoPago) return "mercadopago";
  return "asaas";
}

function settlementPlanForCreation(input: {
  merchantId: string;
  intent: PaymentIntentEntity;
  providerInput: { provider?: string; providerIdempotencyKey?: string; platformFeeCents?: number };
  method: PaymentMethod;
  isStripeCard: boolean;
  usesMercadoPago: boolean;
}): PlannedPaymentSettlement {
  const snapshot = input.intent.snapshot();
  const plannedGrossCents = snapshot.amountCents;
  const plannedPlatformFeeCents = input.providerInput.platformFeeCents ?? snapshot.amountBreakdown?.platformFeeCents ?? 0;
  const plannedMerchantNetCents = plannedGrossCents - plannedPlatformFeeCents;
  if (!Number.isSafeInteger(plannedPlatformFeeCents) || plannedPlatformFeeCents < 0 || plannedMerchantNetCents < 0) {
    throw new BadRequestException("payment_settlement_plan_invalid");
  }
  return {
    merchantId: input.merchantId,
    paymentIntentId: snapshot.id,
    provider: plannedProviderName(input.providerInput, input.method, input),
    currency: snapshot.currency,
    providerReference: input.providerInput.providerIdempotencyKey,
    plannedGrossCents,
    plannedPlatformFeeCents,
    plannedMerchantNetCents,
    // Provider fees are not known at payment creation. A webhook/reconciliation
    // must append them later; this planned snapshot never asserts a settlement.
    plannedProviderFeeCents: 0,
    occurredAt: new Date(),
    entries: [
      ...(plannedPlatformFeeCents > 0 ? [{
        entryKey: "platform_fee" as const,
        entryType: "platform_fee" as const,
        direction: "credit" as const,
        recipientType: "platform" as const,
        plannedAmountCents: plannedPlatformFeeCents,
      }] : []),
      ...(plannedMerchantNetCents > 0 ? [{
        entryKey: "merchant_payout" as const,
        entryType: "merchant_payout" as const,
        direction: "credit" as const,
        recipientType: "merchant" as const,
        recipientReference: input.merchantId,
        plannedAmountCents: plannedMerchantNetCents,
      }] : []),
    ],
  };
}

function providerErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(":")[0]?.trim() || "payment_provider_request_failed";
}

function normalizeProviderException(error: unknown): Error {
  const code = providerErrorCode(error);
  switch (code) {
    case "payment_provider_not_configured":
    case "payment_provider_not_configured_for_customer_creation":
    case "asaas_connection_not_active":
      return new ConflictException(code);
    case "stripe_raw_card_forbidden":
    case "stripe_client_secret_missing":
    case "asaas_payment_missing_id":
    case "asaas_customer_missing_id":
    case "asaas_tokenize_missing_token":
      return new BadGatewayException(code);
    case "asaas_customer_create_failed":
    case "asaas_payment_create_failed":
    case "asaas_tokenize_failed":
      return new BadGatewayException(code);
    default:
      return new BadGatewayException("payment_provider_request_failed");
  }
}

@Injectable()
export class CreatePaymentIntentUseCase {
  private readonly logger = new Logger(CreatePaymentIntentUseCase.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkout: CheckoutSessionRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    @Optional() @Inject(CHECKOUT_PAYMENT_PORT) private readonly checkoutPayment?: CheckoutPaymentPort,
    @Optional() private readonly validateCommerceCart?: ValidateCartForPaymentUseCase,
    @Optional() private readonly syncPendingCommerceOrder?: SyncPendingOrderUseCase,
    @Optional() @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly platformConnections?: PaymentPlatformRepository,
    @Optional() @Inject(OFFER_REPOSITORY)
    private readonly offers?: OfferRepository,
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY)
    private readonly buyerAccount?: BuyerAccountRepository,
    @Optional() private readonly billingMetering?: BillingPlanMeteringService,
    private readonly orderQuota?: OrderQuotaService,
  ) { }

  async execute(body: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponseBody> {
    const merchantId = body.merchant_id.trim();
    const sessionId = body.session_id.trim();
    const idempotencyKey = body.idempotency_key.trim();
    if (!merchantId || !sessionId || !idempotencyKey) throw new BadRequestException("payment_intent_scope_invalid");

    let session = await this.checkout.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    assertCheckoutReadyForPayment(session);

    const existing = await this.payments.getByIdempotency(merchantId, sessionId, idempotencyKey);
    if (existing) {
      assertSameRequest(existing.snapshot(), body, session);
      return publicPayment(await new ResumePaymentCreationService(this.payments, this.provider).execute(existing));
    }

    // An existing idempotency key is an admission made before a later block.
    // Only a brand-new provider/payment attempt must pass the commercial gate.
    await this.orderQuota?.assertCanAcceptNewSales(merchantId);

    const method: PaymentMethod = body.method ?? "pix";

    const acceptedOfferId = await this.validateAcceptedOffer(body, merchantId, sessionId);
    const commerceOrderId = await this.ensurePendingCommerceOrder(merchantId, sessionId, session);

    const itemsSubtotalCents = session.cart.items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
    const shippingCents = Math.round((session.shipping?.customerPrice ?? 0) * 100);
    const discountCents = Math.round((session.cart.currentDiscount ?? 0) * 100);
    const orderAmountCents = itemsSubtotalCents + shippingCents - discountCents;
    if (orderAmountCents <= 0) throw new BadRequestException("payment_intent_amount_invalid");

    // The route is selected by the merchant, then resolved again here. This
    // endpoint is the authority: a client cannot switch an order to a gateway
    // merely by changing a browser request.
    const merchant = await this.merchants.getProfile(merchantId);
    const [asaasConnection, mercadoPagoConnection, stripeConnection] = await Promise.all([
      this.platformConnections?.getConnection(merchantId, "asaas"),
      this.platformConnections?.getConnection(merchantId, "mercadopago"),
      this.platformConnections?.getConnection(merchantId, "stripe"),
    ]);
    const asaasActive = !this.platformConnections || asaasConnection?.status === "active";
    const mercadoPagoActive = mercadoPagoConnection?.status === "active";
    const stripeCardActive =
      isStripeConfigured() &&
      (!this.platformConnections || stripeConnection?.status === "active");
    const mercadoPagoWebhookConfigured = Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim());
    const routes = resolveCheckoutPaymentCapabilities(
      merchant?.storeSettings?.paymentRouting,
      {
        asaas: asaasActive,
        mercadoPagoPix: mercadoPagoActive && mercadoPagoWebhookConfigured,
        mercadoPagoHostedCard: mercadoPagoActive && mercadoPagoWebhookConfigured,
        stripeCard: stripeCardActive,
        // Asaas returns its HTTPS invoice page for card collection. Raw card
        // data remains prohibited in this API.
        // Card via Asaas needs a verified merchant connection. The legacy
        // no-repository fallback remains limited to its existing Pix/boleto
        // behavior and must not claim an unverified hosted-card rail.
        asaasHostedCard: asaasConnection?.status === "active",
      },
    );
    const selectedProvider = method === "crypto" ? "crypto" : routes.providers?.[method];
    if (!selectedProvider) {
      if (method === "pix" && merchant?.storeSettings?.paymentRouting?.pix === "mercadopago" && mercadoPagoActive && !mercadoPagoWebhookConfigured) {
        throw new BadRequestException("mercadopago_webhook_not_configured");
      }
      // Preserve the stable Stripe error for legacy clients that have not set
      // a merchant card preference. Explicit Asaas and Mercado Pago choices
      // are handled above and never fall back to this message.
      throw new BadRequestException(method === "card" ? "stripe_card_not_available" : "payment_provider_not_configured");
    }
    const isStripeCard = method === "card" && selectedProvider === "stripe";
    const usesMercadoPago = selectedProvider === "mercadopago";
    const usesAsaas = selectedProvider === "asaas";
    const delayedMerchantPayout = delayedMerchantPayoutEnabled();
    const merchantPayoutHoldDays = delayedMerchantPayout ? delayedMerchantPayoutHoldDays() : undefined;
    if (delayedMerchantPayout && !usesAsaas) {
      // This rollout implements and reconciles the linked-wallet Asaas path.
      // Stripe, Mercado Pago and crypto remain fail-closed until each has its
      // own transfer executor and provider-receipt contract.
      throw new BadRequestException("delayed_merchant_payout_provider_not_supported");
    }
    const mercadoPagoPayerEmail = session.customer?.email?.trim();
    const mercadoPagoPayerCpf = session.customer?.cpf?.replace(/\D/g, "");
    if (usesMercadoPago && !mercadoPagoPayerEmail) {
      throw new BadRequestException("mercadopago_payer_email_required");
    }
    let stripeConnectAccountId: string | undefined;

    // Modelo iFood — DOIS fees:
    // 1) Buyer service fee (R$0,99 fixo, todos métodos): somado ao amount que o
    //    comprador paga. Receita da plataforma.
    // 2) Merchant transaction fee (fixo por plano): sai do repasse (payment-hold),
    //    NÃO soma ao amount. É retido no split do provedor ao liquidar o pagamento.
    const buyerServiceFeeCents = readBuyerServiceFeeCents();
    const merchantFeeCents = this.billingMetering
      ? merchantTransactionFeeCentsFor(await this.billingMetering.getSubscription(merchantId))
      : 0;

    // application_fee (Stripe Connect): a Zyon retém buyer fee + merchant fee do
    // split; o merchant recebe orderAmount − merchantFee. Cap ao valor cobrado.
    let stripeApplicationFeeCents = 0;
    let mercadoPagoPlatformFeeCents = 0;

    if (isStripeCard) {
      stripeConnectAccountId = await this.merchants.getStripeConnectAccountId(merchantId);
      stripeConnectAccountId =
        stripeConnection?.externalAccountId ?? stripeConnectAccountId;
      if (!stripeConnectAccountId) {
        throw new BadRequestException("stripe_connect_not_configured");
      }
      stripeApplicationFeeCents = buyerServiceFeeCents + merchantFeeCents;
    }

    // Buyer paga o total do pedido + a taxa de serviço, em qualquer método.
    const amountCents = orderAmountCents + buyerServiceFeeCents;
    // Guard: application_fee nunca pode exceder o total cobrado (Stripe recusa).
    if (isStripeCard) {
      stripeApplicationFeeCents = assertProviderFeeCap(stripeApplicationFeeCents, amountCents);
    }
    if (usesMercadoPago) {
      mercadoPagoPlatformFeeCents = assertProviderFeeCap(buyerServiceFeeCents + merchantFeeCents, amountCents);
    }
    const amountBreakdown: PaymentAmountBreakdown = {
      version: 1, currency: session.cart.currency.toUpperCase(),
      cartFingerprint: paymentCartFingerprint(session),
      itemsSubtotalCents,
      discountCents,
      shippingCents,
      platformFeeCents: buyerServiceFeeCents, totalCents: amountCents,
    };
    let asaasCustomer = resolveAsaasCustomerIdFromSession(session);
    let asaasPayoutDestination: string | undefined;

    if (delayedMerchantPayout && usesAsaas) {
      const asaasConnection = await this.platformConnections?.getConnection(merchantId, "asaas");
      if (
        asaasConnection?.status !== "active" ||
        !asaasConnection.payoutsEnabled ||
        !asaasConnection.walletId?.trim()
      ) {
        throw new BadRequestException("asaas_merchant_payout_destination_not_ready");
      }
      asaasPayoutDestination = asaasConnection.walletId.trim();
    }

    // Validate the exact Asaas route and required split wallet before creating
    // a provider customer. `preparePayment` is a local, no-network preflight;
    // this avoids orphan customers when a seller integration is misconfigured.
    if (usesAsaas && this.provider.preparePayment) {
      await this.provider.preparePayment({
        provider: "asaas",
        merchantId,
        sessionId,
        intentId: `preflight_${sessionId}`,
        providerIdempotencyKey: deriveProviderIdempotencyKey(merchantId, sessionId, idempotencyKey),
        amountCents,
        currency: session.cart.currency.toUpperCase(),
        method,
        platformFeeCents: assertProviderFeeCap(buyerServiceFeeCents + merchantFeeCents, amountCents),
        ...(delayedMerchantPayout
          ? {
              settlementMode: "delayed_merchant_payout" as const,
              merchantPayoutDestination: asaasPayoutDestination,
              merchantPayoutHoldDays,
            }
          : {}),
      });
    }

    if (usesAsaas && !asaasCustomer) {
      let customer = session.customer;

      // Hydrate customer from buyer-account if session is missing required fields
      if ((!customer?.fullName || !customer?.email || !customer?.cpf || !customer?.asaasCustomerId) && session.globalUserId && this.buyerAccount) {
        const account = await this.buyerAccount.findByGlobalUserId(session.globalUserId).catch(() => null);
        if (account) {
          customer = {
            ...customer,
            fullName: customer?.fullName || account.displayName || undefined,
            email: customer?.email || account.email || undefined,
            phone: customer?.phone || account.phone || undefined,
            cpf: customer?.cpf || (account as any).cpf || undefined,
            asaasCustomerId: customer?.asaasCustomerId || (account as any).asaasCustomerId || undefined,
          };
          // Persist hydrated customer to session for future use
          const hydrated: CheckoutSession = { ...session, customer, updatedAt: new Date().toISOString() };
          await this.checkout.saveSession(hydrated);
          session = hydrated;
        }
      }

      if (!customer?.fullName || !customer?.email || !customer?.cpf) {
        throw new BadRequestException("asaas_customer_data_incomplete");
      }
      if (!this.provider.createCustomer) {
        throw new BadRequestException("asaas_customer_id_missing_on_buyer_session");
      }
      try {
        asaasCustomer = await this.provider.createCustomer({
          merchantId,
          name: customer.fullName,
          email: customer.email,
          cpfCnpj: customer.cpf,
          phone: customer.phone ?? undefined,
          ...(delayedMerchantPayout ? { settlementMode: "delayed_merchant_payout" as const } : {}),
        });
      } catch (error) {
        this.logger.error(`payment.customer_create_failed: ${error instanceof Error ? error.message : String(error)}`);
        throw normalizeProviderException(error);
      }
      // A delayed Asaas charge uses the platform account. Its customer id must
      // never be cached in the merchant-owned checkout profile, or a later
      // immediate merchant charge could try to reuse a foreign customer id.
      if (!delayedMerchantPayout) {
        const updatedSession: CheckoutSession = {
          ...session,
          customer: { ...session.customer!, asaasCustomerId: asaasCustomer },
          updatedAt: new Date().toISOString()
        };
        await this.checkout.saveSession(updatedSession);
      }
    }

    const intent = PaymentIntentEntity.create({
      merchantId,
      sessionId,
      idempotencyKey,
      amountCents,
      currency: session.cart.currency.toUpperCase(),
      method,
      acceptedOfferId,
      commerceOrderId,
      amountBreakdown
    });

    if (body.credit_card) throw new BadRequestException("raw_card_forbidden");
    let providerInput: CreateProviderPaymentInput = {
      merchantId, sessionId, intentId: intent.id,
      providerIdempotencyKey: deriveProviderIdempotencyKey(merchantId, sessionId, idempotencyKey),
      amountCents, currency: intent.snapshot().currency, method,
      description: paymentDescription(merchant?.name === merchantId ? undefined : merchant?.name, session),
        ...(isStripeCard ? {
          provider: "stripe" as const,
          stripeConnectAccountId,
          stripeChargeMode: "direct_v2" as const,
          platformFeeCents: stripeApplicationFeeCents,
        }
        : usesMercadoPago ? {
            provider: "mercadopago" as const,
            platformFeeCents: mercadoPagoPlatformFeeCents,
            payerEmail: mercadoPagoPayerEmail,
            payerName: session.customer?.fullName?.trim(),
            ...(mercadoPagoPayerCpf?.length === 11
              ? { payerIdentification: { type: "CPF" as const, number: mercadoPagoPayerCpf } }
              : {}),
          }
          : usesAsaas ? {
              provider: "asaas" as const,
              ...(delayedMerchantPayout
                ? {
                    settlementMode: "delayed_merchant_payout" as const,
                    merchantPayoutDestination: asaasPayoutDestination,
                    merchantPayoutHoldDays,
                  }
                : {}),
              asaasCustomerId: resolveAsaasCustomerForProvider(asaasCustomer),
              platformFeeCents: assertProviderFeeCap(buyerServiceFeeCents + merchantFeeCents, amountCents),
            }
            : { platformFeeCents: assertProviderFeeCap(buyerServiceFeeCents + merchantFeeCents, amountCents) }),
    };
    try {
      if (this.provider.preparePayment) providerInput = await this.provider.preparePayment(providerInput);
    } catch (error) {
      if (error instanceof PaymentCreationRejectedError) throw new ConflictException(error.code);
      throw error;
    }
    intent.prepareCreation(providerInput);
    const settlementPlan = settlementPlanForCreation({
      merchantId,
      intent,
      providerInput,
      method,
      isStripeCard,
      usesMercadoPago,
    });
    try { await this.payments.saveIntentWithSettlementPlan({ intent, settlementPlan }); }
    catch (error) {
      if (!(error instanceof PaymentIntentConflictError)) throw error;
      const winner = await this.payments.getByIdempotency(merchantId, sessionId, idempotencyKey);
      if (!winner) throw new ConflictException("payment_creation_concurrent_change");
      assertSameRequest(winner.snapshot(), { ...body, method }, session);
      return publicPayment(await new ResumePaymentCreationService(this.payments, this.provider).execute(winner));
    }
    return publicPayment(await new ResumePaymentCreationService(this.payments, this.provider).execute(intent));
  }

  private async validateAcceptedOffer(
    body: CreatePaymentIntentRequest,
    merchantId: string,
    sessionId: string
  ): Promise<string | undefined> {
    const offerId = normalizeAcceptedOfferId(body);
    if (!offerId) return undefined;
    const accepted = await this.offers?.getAcceptedOffer(merchantId, sessionId, offerId);
    if (!accepted || Date.parse(accepted.expiresAt) <= Date.now()) {
      throw new BadRequestException("accepted_offer_invalid");
    }
    return offerId;
  }

  private async ensurePendingCommerceOrder(
    merchantId: string,
    sessionId: string,
    session: CheckoutSession
  ): Promise<string | undefined> {
    const commerceCartRef = commerceCartRefFrom(session);
    if (!commerceCartRef) return undefined;
    if (!this.validateCommerceCart || !this.syncPendingCommerceOrder) {
      throw new BadRequestException("commerce_sync_not_configured");
    }

    const { trustedCart } = await this.validateCommerceCart.execute({
      merchantId,
      commerceCartRef,
      clientReportedTotalCents: Math.round(session.cart.total * 100)
    });
    const { commerceOrderId } = await this.syncPendingCommerceOrder.execute({
      merchantId,
      sessionId,
      cart: trustedCart
    });
    return commerceOrderId;
  }

}
