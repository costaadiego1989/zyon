import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentIntentEntity, type PaymentIntentSnapshot, type PaymentMethod } from "../domain/payment-intent.entity.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository
} from "../domain/ports/payment-repository.port.js";
import type { PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { PAYMENT_PROVIDER_PORT } from "../domain/ports/payment-provider.port.js";
import type { CheckoutSession } from "@aacp/shared-types";
import { isAsaasConfigured } from "../infrastructure/asaas-env.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";

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
  /** IP do comprador — repassado para tokenização Asaas (PCI compliance). */
  remote_ip?: string;
};

export type CreatePaymentIntentResponseBody = PaymentIntentSnapshot;

function resolveAsaasCustomerIdFromSession(session: CheckoutSession): string | undefined {
  const cid = session.customer?.asaasCustomerId;
  const trimmed = typeof cid === "string" ? cid.trim() : "";
  return trimmed || undefined;
}

@Injectable()
export class CreatePaymentIntentUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkout: CheckoutSessionRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) { }

  async execute(body: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponseBody> {
    const merchantId = body.merchant_id.trim();
    const sessionId = body.session_id.trim();
    const idempotencyKey = body.idempotency_key.trim();
    if (!merchantId || !sessionId || !idempotencyKey) throw new BadRequestException("payment_intent_scope_invalid");

    const session = await this.checkout.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const existing = await this.payments.getByIdempotency(merchantId, sessionId, idempotencyKey);
    if (existing) return existing.snapshot();

    const amountMajorUnits = Math.max(
      0,
      session.cart.total + (session.shipping?.customerPrice ?? 0) - (session.cart.currentDiscount ?? 0)
    );
    const amountCents = Math.round(amountMajorUnits * 100);
    if (amountCents <= 0) throw new BadRequestException("payment_intent_amount_invalid");

    const method: PaymentMethod = body.method ?? "pix";
    const asaasCustomer = resolveAsaasCustomerIdFromSession(session);

    if (isAsaasConfigured() && !asaasCustomer) {
      throw new BadRequestException("asaas_customer_id_missing_on_buyer_session");
    }

    const intent = PaymentIntentEntity.create({
      merchantId,
      sessionId,
      idempotencyKey,
      amountCents,
      currency: session.cart.currency.toUpperCase(),
      method,
      acceptedOfferId: typeof body.accepted_offer_id === "string" ? body.accepted_offer_id.trim() || undefined : undefined
    });

    let creditCardHolderInfo: any = undefined;
    if (method === "card" && session.customer) {
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
      asaasCustomerId: asaasCustomer ?? "cust_fake_test_placeholder",
      description: `${merchantId}:${sessionId}`,
      creditCard: method === "card" ? body.credit_card : undefined,
      creditCardHolderInfo,
      remoteIp: body.remote_ip
    });

    intent.markRequiresAction({ providerPaymentId: created.providerPaymentId });
    intent.setBuyerFacingPayload({
      ...(created.buyerFacingPayload ?? {})
    });

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
          method
        },
        causationId: intent.id
      })
    );

    return intent.snapshot();
  }
}
