import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { PaymentIntentEntity, type PaymentIntentSnapshot, type PaymentMethod } from "../domain/payment-intent.entity.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository
} from "../domain/ports/payment-repository.port.js";
import type { CreateProviderPaymentOutput, PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { PAYMENT_PROVIDER_PORT } from "../domain/ports/payment-provider.port.js";
import type { CheckoutSession, CurrencyCode } from "@aacp/shared-types";
import { isStripeConfigured, readPlatformFeeCents } from "../infrastructure/stripe-env.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import { CHECKOUT_PAYMENT_PORT, type CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
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

function commerceCartRefFrom(session: CheckoutSession): string | undefined {
  const ref = session.cart.commerceCartRef?.trim();
  return ref || undefined;
}

function paymentDescription(merchantId: string, sessionId: string, commerceOrderId: string | undefined): string {
  const base = `${merchantId}:${sessionId}`;
  return commerceOrderId ? `${base}:commerce_order:${commerceOrderId}` : base;
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
  ) { }

  async execute(body: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponseBody> {
    const merchantId = body.merchant_id.trim();
    const sessionId = body.session_id.trim();
    const idempotencyKey = body.idempotency_key.trim();
    if (!merchantId || !sessionId || !idempotencyKey) throw new BadRequestException("payment_intent_scope_invalid");

    const session = await this.checkout.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    assertCheckoutReadyForPayment(session);

    const existing = await this.payments.getByIdempotency(merchantId, sessionId, idempotencyKey);
    if (existing) return existing.snapshot();

    const method: PaymentMethod = body.method ?? "pix";
    if (method === "card" && !isStripeConfigured()) {
      throw new ConflictException("stripe_provider_not_configured");
    }

    const commerceOrderId = await this.ensurePendingCommerceOrder(merchantId, sessionId, session);

    const orderAmountMajorUnits = Math.max(
      0,
      session.cart.total + (session.shipping?.customerPrice ?? 0) - (session.cart.currentDiscount ?? 0)
    );
    const orderAmountCents = Math.round(orderAmountMajorUnits * 100);
    if (orderAmountCents <= 0) throw new BadRequestException("payment_intent_amount_invalid");

    const isStripeCard = method === "card";
    const usesAsaas = method !== "crypto" && method !== "card";
    let stripeConnectAccountId: string | undefined;
    let platformFeeCents = 0;

    if (isStripeCard) {
      const stripeConnection =
        await this.platformConnections?.getConnection(
          merchantId,
          "stripe",
        );
      if (
        this.platformConnections &&
        stripeConnection?.status !== "active"
      ) {
        throw new BadRequestException("stripe_connect_not_active");
      }
      stripeConnectAccountId = await this.merchants.getStripeConnectAccountId(merchantId);
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
      const customer = session.customer;
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
      acceptedOfferId: typeof body.accepted_offer_id === "string" ? body.accepted_offer_id.trim() || undefined : undefined,
      commerceOrderId
    });

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
      throw normalizeProviderException(error);
    }

    intent.markRequiresAction({ providerPaymentId: created.providerPaymentId });
    intent.setBuyerFacingPayload({
      ...(created.buyerFacingPayload ?? {})
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
