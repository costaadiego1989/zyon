import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PaymentIntentEntity, type PaymentIntentSnapshot, type PaymentMethod } from "../domain/payment-intent.entity.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository
} from "../domain/ports/payment-repository.port.js";
import type { PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { PAYMENT_PROVIDER_PORT } from "../domain/ports/payment-provider.port.js";
import type { CheckoutSession, CurrencyCode } from "@aacp/shared-types";
import { isAsaasConfigured } from "../infrastructure/asaas-env.js";
import { isStripeConfigured } from "../infrastructure/stripe-env.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import { CHECKOUT_PAYMENT_PORT, type CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { ValidateCartForPaymentUseCase } from "../../commerce/application/validate-cart-for-payment.use-case.js";
import { SyncPendingOrderUseCase } from "../../commerce/application/sync-pending-order.use-case.js";

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

function shouldAutoApproveFakePayment(providerPaymentId: string | undefined): boolean {
  if (!providerPaymentId?.startsWith("fake_")) return false;
  return process.env.PAYMENT_FAKE_AUTO_APPROVE === "true" || process.env.E2E_SEED_ENABLED === "true";
}

function shouldForceFakePaymentProvider(): boolean {
  return process.env.PAYMENT_PROVIDER === "fake" || process.env.E2E_SEED_ENABLED === "true";
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

@Injectable()
export class CreatePaymentIntentUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkout: CheckoutSessionRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() @Inject(CHECKOUT_PAYMENT_PORT) private readonly checkoutPayment?: CheckoutPaymentPort,
    @Optional() private readonly validateCommerceCart?: ValidateCartForPaymentUseCase,
    @Optional() private readonly syncPendingCommerceOrder?: SyncPendingOrderUseCase
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

    const commerceOrderId = await this.ensurePendingCommerceOrder(merchantId, sessionId, session);

    const amountMajorUnits = Math.max(
      0,
      session.cart.total + (session.shipping?.customerPrice ?? 0) - (session.cart.currentDiscount ?? 0)
    );
    const amountCents = Math.round(amountMajorUnits * 100);
    if (amountCents <= 0) throw new BadRequestException("payment_intent_amount_invalid");

    const method: PaymentMethod = body.method ?? "pix";
    let asaasCustomer = resolveAsaasCustomerIdFromSession(session);

    const useFakeProvider = shouldForceFakePaymentProvider();
    const needsAsaas =
      method !== "crypto" &&
      !useFakeProvider &&
      isAsaasConfigured() &&
      !(method === "card" && isStripeConfigured());
    if (needsAsaas && !asaasCustomer) {
      const customer = session.customer;
      if (!customer?.fullName || !customer?.email || !customer?.cpf) {
        throw new BadRequestException("asaas_customer_data_incomplete");
      }
      if (!this.provider.createCustomer) {
        throw new BadRequestException("asaas_customer_id_missing_on_buyer_session");
      }
      asaasCustomer = await this.provider.createCustomer({
        name: customer.fullName,
        email: customer.email,
        cpfCnpj: customer.cpf,
        phone: customer.phone ?? undefined
      });
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

    const isStripeCard = !useFakeProvider && method === "card" && isStripeConfigured();

    let creditCardHolderInfo: any = undefined;
    if (method === "card" && !isStripeCard && session.customer) {
      creditCardHolderInfo = {
        name: session.customer.fullName || "Comprador",
        email: session.customer.email || "",
        cpfCnpj: session.customer.cpf || "",
        postalCode: session.customer.address?.zip || "",
        addressNumber: session.customer.address?.number || "S/N",
        phone: session.customer.phone || ""
      };
    }

    const created = await this.provider.createPayment({
      merchantId,
      sessionId,
      intentId: intent.id,
      amountCents,
      currency: intent.snapshot().currency,
      method,
      description: paymentDescription(merchantId, sessionId, commerceOrderId),
      ...(isStripeCard
        ? {}
        : {
            asaasCustomerId: asaasCustomer ?? "cust_fake_test_placeholder",
            creditCard: body.credit_card,
            creditCardHolderInfo,
            remoteIp: body.remote_ip
          })
    });

    intent.markRequiresAction({ providerPaymentId: created.providerPaymentId });
    intent.setBuyerFacingPayload({
      ...(created.buyerFacingPayload ?? {})
    });

    if (shouldAutoApproveFakePayment(created.providerPaymentId) && this.checkoutPayment) {
      intent.markApproved({
        providerPaymentId: created.providerPaymentId,
        approvedAmountCents: amountCents
      });
    } else if (
      method === "crypto" &&
      useFakeProvider &&
      created.providerPaymentId.startsWith("fake_crypto_") &&
      this.checkoutPayment
    ) {
      intent.markApproved({
        providerPaymentId: created.providerPaymentId,
        approvedAmountCents: amountCents
      });
    }

    await this.payments.saveIntent({ intent });
    await this.outbox.appendOutbox(
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
