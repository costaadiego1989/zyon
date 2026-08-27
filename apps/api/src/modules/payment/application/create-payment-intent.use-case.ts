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
import { PaymentIntentEntity, type PaymentIntentSnapshot, type PaymentMethod } from "../domain/payment-intent.entity.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { OFFER_REPOSITORY, type OfferRepository } from "../../checkout/domain/ports/offer.repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository
} from "../domain/ports/payment-repository.port.js";
import type { CreateProviderPaymentOutput, PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { PAYMENT_PROVIDER_PORT } from "../domain/ports/payment-provider.port.js";
import type { CheckoutSession, CurrencyCode } from "@zyon/shared-types";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { isStripeConfigured, readPlatformFeeCents } from "../infrastructure/stripe-env.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import { CHECKOUT_PAYMENT_PORT, type CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { ValidateCartForPaymentUseCase } from "../../commerce/application/validate-cart-for-payment.use-case.js";
import { SyncPendingOrderUseCase } from "../../commerce/application/sync-pending-order.use-case.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../domain/ports/payment-platform-repository.port.js";

export type CreatePaymentIntentRequest = {
  merchant_id: string;
  session_id: string;
  idempotency_key: string;
  method?: PaymentMethod;
  accepted_offer_id?: string;
  credit_card?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  remote_ip?: string;
};

export type CreatePaymentIntentResponseBody = PaymentIntentSnapshot;

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

function paymentDescription(merchantId: string, sessionId: string, commerceOrderId: string | undefined): string {
  const base = `${merchantId}:${sessionId}`;
  return commerceOrderId ? `${base}:commerce_order:${commerceOrderId}` : base;
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
    if (existing) return existing.snapshot();

    const method: PaymentMethod = body.method ?? "pix";

    const acceptedOfferId = await this.validateAcceptedOffer(body, merchantId, sessionId);
    const commerceOrderId = await this.ensurePendingCommerceOrder(merchantId, sessionId, session);

    const orderAmountMajorUnits = Math.max(
      0,
      session.cart.total + (session.shipping?.customerPrice ?? 0) - (session.cart.currentDiscount ?? 0)
    );
    const orderAmountCents = Math.round(orderAmountMajorUnits * 100);
    if (orderAmountCents <= 0) throw new BadRequestException("payment_intent_amount_invalid");

    // Card routing: prefer Stripe when the merchant has an ACTIVE Stripe
    // connection; otherwise fall back to Asaas (which processes credit cards in
    // Brazil). This mirrors RoutingPaymentAdapter and prevents a hard failure
    // when Stripe is restricted/inactive but Asaas is active.
    let stripeCardActive = false;
    if (method === "card") {
      const stripeConnection = await this.platformConnections?.getConnection(merchantId, "stripe");
      stripeCardActive =
        isStripeConfigured() &&
        (!this.platformConnections || stripeConnection?.status === "active");
    }

    const isStripeCard = method === "card" && stripeCardActive;
    const usesAsaas = method !== "crypto" && !isStripeCard;
    let stripeConnectAccountId: string | undefined;
    let platformFeeCents = 0;

    if (isStripeCard) {
      stripeConnectAccountId = await this.merchants.getStripeConnectAccountId(merchantId);
      const stripeConnection = await this.platformConnections?.getConnection(merchantId, "stripe");
      stripeConnectAccountId =
        stripeConnection?.externalAccountId ?? stripeConnectAccountId;
      if (!stripeConnectAccountId) {
        throw new BadRequestException("stripe_connect_not_configured");
      }
      platformFeeCents = readPlatformFeeCents();
    }

    const amountCents = orderAmountCents + platformFeeCents;
    let asaasCustomer = resolveAsaasCustomerIdFromSession(session);

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
          phone: customer.phone ?? undefined
        });
      } catch (error) {
        this.logger.error(`payment.customer_create_failed: ${error instanceof Error ? error.message : String(error)}`);
        throw normalizeProviderException(error);
      }
      const updatedSession: CheckoutSession = {
        ...session,
        customer: { ...session.customer!, asaasCustomerId: asaasCustomer },
        updatedAt: new Date().toISOString()
      };
      await this.checkout.saveSession(updatedSession);
    }

    const intent = PaymentIntentEntity.create({
      merchantId,
      sessionId,
      idempotencyKey,
      amountCents,
      currency: session.cart.currency.toUpperCase(),
      method,
      acceptedOfferId,
      commerceOrderId
    });

    // Reserve the idempotency row in `pending` BEFORE calling the provider, so a
    // crash between charge and persist cannot leave a live provider charge with
    // no local row (which a retry would not find, creating a second charge).
    // The stable provider idempotency key below aligns provider-side dedupe
    // with this local tuple (ADR 0001 #6).
    await this.payments.saveIntent({ intent });

    let creditCardHolderInfo: any = undefined;
    if (method === "card" && usesAsaas && session.customer) {
      creditCardHolderInfo = {
        name: session.customer.fullName || "Comprador",
        email: session.customer.email || "",
        cpfCnpj: session.customer.cpf || "",
        postalCode: session.customer.address?.zip || "",
        addressNumber: session.customer.address?.number || "S/N",
        phone: session.customer.phone || ""
      };
    }

    let created: CreateProviderPaymentOutput;
    try {
      created = await this.provider.createPayment({
        merchantId,
        sessionId,
        intentId: intent.id,
        providerIdempotencyKey: deriveProviderIdempotencyKey(merchantId, sessionId, idempotencyKey),
        amountCents,
        currency: intent.snapshot().currency,
        method,
        description: paymentDescription(merchantId, sessionId, commerceOrderId),
        ...(isStripeCard
          ? { stripeConnectAccountId, platformFeeCents }
          : usesAsaas
            ? {
              asaasCustomerId: resolveAsaasCustomerForProvider(asaasCustomer),
              creditCard: body.credit_card,
              creditCardHolderInfo,
              remoteIp: body.remote_ip
            }
            : {})
      });
    } catch (error) {
      this.logger.error(`payment.provider_create_failed: ${error instanceof Error ? error.message : String(error)}`);
      throw normalizeProviderException(error);
    }

    intent.markRequiresAction({ providerPaymentId: created.providerPaymentId });
    intent.setBuyerFacingPayload({
      ...(created.buyerFacingPayload ?? {})
    });

    this.logger.log({ event: "payment_intent.provider_created", intentId: intent.id, method });

    this.logger.log({
      event: "payment_intent.created",
      merchantId,
      sessionId,
      method,
      amountCents,
      intentId: intent.id,
    });

    await this.payments.saveIntentWithOutbox(
      { intent },
      createCheckoutEventEnvelope({
        eventType: "payment.status.changed",
        merchantId,
        payload: {
          session_id: sessionId,
          payment_intent_id: intent.id,
          status: intent.snapshot().status,
          amount_cents: amountCents,
          method,
          commerce_order_id: commerceOrderId
        },
        causationId: intent.id
      })
    );

    if (intent.status === "approved" && this.checkoutPayment) {
      await this.checkoutPayment.completeAfterApproval({
        merchantId,
        sessionId,
        externalOrderId: created.providerPaymentId,
        orderTotalMajorUnits: Number((amountCents / 100).toFixed(2)),
        currency: session.cart.currency.toUpperCase() as CurrencyCode,
        acceptedOfferId: intent.snapshot().acceptedOfferId
      });
    }

    return intent.snapshot();
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
