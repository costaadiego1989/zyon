import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentIntentEntity, type PaymentIntentSnapshot, type PaymentMethod } from "../domain/payment-intent.entity.js";
import type { CheckoutRepository } from "../../checkout/domain/ports/checkout-repository.port.js";
import { CHECKOUT_REPOSITORY } from "../../checkout/domain/ports/checkout-repository.port.js";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository
} from "../domain/ports/payment-repository.port.js";
import type { PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { PAYMENT_PROVIDER_PORT } from "../domain/ports/payment-provider.port.js";
import type { CheckoutSession } from "@aacp/shared-types";
import { isAsaasConfigured } from "../infrastructure/asaas-env.js";

export type CreatePaymentIntentRequest = {
  merchant_id: string;
  session_id: string;
  idempotency_key: string;
  method?: PaymentMethod;
  accepted_offer_id?: string;
};

export type CreatePaymentIntentResponseBody = PaymentIntentSnapshot;

/** Cliente Asaas deve vir do pagador já guardado na sessão (`customer.asaasCustomerId`). */
function resolveAsaasCustomerIdFromSession(session: CheckoutSession): string | undefined {
  const cid = session.customer?.asaasCustomerId;
  const trimmed = typeof cid === "string" ? cid.trim() : "";
  return trimmed || undefined;
}

@Injectable()
export class CreatePaymentIntentUseCase {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly checkout: CheckoutRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort
  ) {}

  async execute(body: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponseBody> {
    const merchantId = body.merchant_id.trim();
    const sessionId = body.session_id.trim();
    const idempotencyKey = body.idempotency_key.trim();
    if (!merchantId || !sessionId || !idempotencyKey) throw new BadRequestException("payment_intent_scope_invalid");

    const session = await this.checkout.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const existing = await this.payments.getByIdempotency(merchantId, sessionId, idempotencyKey);
    if (existing) return existing.snapshot();

    const amountCents = Math.round(session.cart.total * 100);
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

    const created = await this.provider.createPayment({
      merchantId,
      sessionId,
      intentId: intent.id,
      amountCents,
      currency: intent.snapshot().currency,
      method,
      asaasCustomerId: asaasCustomer ?? "cust_fake_test_placeholder",
      description: `${merchantId}:${sessionId}`
    });

    intent.markRequiresAction({ providerPaymentId: created.providerPaymentId });
    intent.setBuyerFacingPayload({
      ...(created.buyerFacingPayload ?? {})
    });

    await this.payments.saveIntent({ intent });

    return intent.snapshot();
  }
}
