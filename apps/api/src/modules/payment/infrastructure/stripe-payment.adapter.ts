import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";

@Injectable()
export class StripePaymentAdapter implements PaymentProviderPort {
  private readonly stripe: Stripe;
  private readonly publishableKey: string;

  constructor(secretKey: string, publishableKey: string) {
    this.stripe = new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" });
    this.publishableKey = publishableKey;
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    if (input.creditCard) {
      throw new Error("stripe_raw_card_forbidden");
    }

    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: {
          merchant_id: input.merchantId,
          session_id: input.sessionId,
          intent_id: input.intentId
        },
        description: input.description ?? `${input.merchantId}:${input.sessionId}`
      },
      { idempotencyKey: input.intentId }
    );

    if (!paymentIntent.client_secret) {
      throw new Error("stripe_client_secret_missing");
    }

    return {
      providerPaymentId: paymentIntent.id,
      status: "requires_action",
      buyerFacingPayload: {
        clientSecret: paymentIntent.client_secret,
        stripePublishableKey: this.publishableKey
      }
    };
  }
}
