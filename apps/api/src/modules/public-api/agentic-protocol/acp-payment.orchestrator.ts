import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Cart, CheckoutSession } from "@zyon/shared-types";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { CreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";
import type { EmbedTokenClaims } from "../../embed/domain/embed-token.service.js";

export type AcpPaymentMethodInput = "pix" | "credit_card" | "boleto" | "crypto";
export type AcpPaymentMethod =
  | "pix"
  | "card"
  | "boleto"
  | "crypto";

export interface AcpCompleteBody {
  payment_token: string;
  payment_method?: AcpPaymentMethodInput;
  idempotency_key?: string;
  buyer_email?: string;
  accepted_offer_id?: string;
}

export interface AcpCompleteResult {
  orderId: string;
  orderTotal: number;
  intent: Awaited<ReturnType<CreatePaymentIntentUseCase["execute"]>>;
}

/**
 * Owns the payment-side orchestration for `complete`: stable idempotency
 * key derivation, ACP -> platform payment-method mapping, and the
 * CreatePaymentIntent + CompleteOrder pair.
 */
@Injectable()
export class AcpPaymentOrchestrator {
  constructor(
    private readonly createPaymentIntent: CreatePaymentIntentUseCase,
    private readonly completeOrder: CompleteOrderUseCase,
  ) {}

  async createIntentAndComplete(
    merchantId: string,
    sessionId: string,
    _session: CheckoutSession,
    body: AcpCompleteBody,
    claims: EmbedTokenClaims,
  ): Promise<AcpCompleteResult> {
    const idempotencyKey = (
      body.idempotency_key ?? deriveStableIdempotencyKey(sessionId, claims)
    ).trim();
    const method = mapPaymentMethod(body.payment_method);

    const intent = await this.createPaymentIntent.execute({
      merchant_id: merchantId,
      session_id: sessionId,
      idempotency_key: idempotencyKey,
      method,
      accepted_offer_id: body.accepted_offer_id,
    });

    const orderId = intent.providerPaymentId ?? intent.id;
    const orderTotalMajor = intent.amountCents / 100;

    await this.completeOrder.execute({
      merchant_id: merchantId,
      session_id: sessionId,
      external_order_id: orderId,
      order_total: orderTotalMajor,
      currency: intent.currency as Cart["currency"],
      accepted_offer_id: body.accepted_offer_id,
    });

    return { orderId, orderTotal: orderTotalMajor, intent };
  }
}

export function deriveStableIdempotencyKey(
  sessionId: string,
  claims: EmbedTokenClaims,
): string {
  return createHash("sha256")
    .update(`${sessionId}:${claims.installationId ?? claims.merchantId}:${claims.nonce}`)
    .digest("hex");
}

export function mapPaymentMethod(
  method: AcpPaymentMethodInput | undefined,
): AcpPaymentMethod {
  switch (method) {
    case "credit_card":
      return "card";
    case "boleto":
      return "boleto";
    case "crypto":
      return "crypto";
    case "pix":
    case undefined:
    default:
      return "pix";
  }
}
