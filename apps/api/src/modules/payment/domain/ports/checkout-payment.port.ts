import type { CurrencyCode } from "@aacp/shared-types";
import type { PaymentIntentStatus } from "../payment-intent.entity.js";

export const CHECKOUT_PAYMENT_PORT = Symbol("CHECKOUT_PAYMENT_PORT");

export type CheckoutPaymentApprovedInput = {
  merchantId: string;
  sessionId: string;
  externalOrderId: string;
  orderTotalMajorUnits: number;
  currency: CurrencyCode;
  acceptedOfferId?: string;
};

export interface CheckoutPaymentPort {
  /** Grava pedido completado quando o pagamento é aprovado (idempotente via CompleteOrderUseCase). */
  completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void>;
  recordPaymentFailure(params: {
    merchantId: string;
    sessionId: string;
    /** Motivo textual curto para analytics / decisão downstream */
    reason: string;
  }): Promise<void>;
  recordPaymentStatusChanged(params: {
    merchantId: string;
    sessionId: string;
    paymentIntentId: string;
    status: PaymentIntentStatus;
    reason?: string;
  }): Promise<void>;
}
