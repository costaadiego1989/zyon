import { randomUUID } from "node:crypto";

const FORBIDDEN_PAYMENT_INPUT_KEYS = ["unsafeRawCardPan", "cvv", "cardNumber", "rawPan", "pan"] as const;

export type PaymentMethod = "pix" | "card" | "boleto";

export type PaymentIntentStatus =
  | "pending"
  | "requires_action"
  | "approved"
  | "failed"
  | "cancelled"
  | "refunded";

export type PaymentIntentCreateInput = {
  merchantId: string;
  sessionId: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  acceptedOfferId?: string;
};

export type PaymentIntentSnapshot = {
  id: string;
  merchantId: string;
  sessionId: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentIntentStatus;
  providerPaymentId?: string;
  approvedAmountCents?: number;
  acceptedOfferId?: string;
  buyerFacing?: { qrCodeCopyPaste?: string; invoiceUrl?: string; encodedQrImage?: string };
};

type MutableState = Omit<PaymentIntentSnapshot, never>;

export class PaymentIntentEntity {
  private constructor(private s: MutableState) {}

  static create(input: PaymentIntentCreateInput): PaymentIntentEntity {
    const probe = input as unknown as Record<string, unknown>;
    for (const key of FORBIDDEN_PAYMENT_INPUT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(probe, key)) {
        throw new Error("raw_card_forbidden");
      }
    }
    const merchantId = input.merchantId.trim();
    const sessionId = input.sessionId.trim();
    const idempotencyKey = input.idempotencyKey.trim();
    if (!merchantId || !sessionId || !idempotencyKey) throw new Error("payment_intent_scope_invalid");
    if (input.amountCents <= 0) throw new Error("payment_intent_amount_invalid");
    if (!input.currency.trim()) throw new Error("payment_intent_currency_invalid");

    const acceptedOfferId =
      typeof input.acceptedOfferId === "string" ? input.acceptedOfferId.trim() || undefined : undefined;

    return new PaymentIntentEntity({
      id: `pay_int_${randomUUID()}`,
      merchantId,
      sessionId,
      idempotencyKey,
      amountCents: input.amountCents,
      currency: input.currency.trim().toUpperCase(),
      method: input.method,
      status: "pending",
      acceptedOfferId
    });
  }

  static rehydrate(snapshot: PaymentIntentSnapshot): PaymentIntentEntity {
    return new PaymentIntentEntity({ ...snapshot });
  }

  snapshot(): PaymentIntentSnapshot {
    return { ...this.s };
  }

  get status(): PaymentIntentStatus {
    return this.s.status;
  }

  get id(): string {
    return this.s.id;
  }

  markRequiresAction(params?: { providerPaymentId?: string }): void {
    if (this.s.status !== "pending") throw new Error("illegal_transition");
    const pid = params?.providerPaymentId?.trim();
    if (pid) this.s.providerPaymentId = pid;
    this.s.status = "requires_action";
  }

  setBuyerFacingPayload(payload: NonNullable<PaymentIntentSnapshot["buyerFacing"]>): void {
    if (this.s.status !== "pending" && this.s.status !== "requires_action") {
      throw new Error("illegal_transition");
    }
    this.s.buyerFacing = { ...payload };
  }

  markFailed(): void {
    if (this.s.status !== "pending" && this.s.status !== "requires_action") {
      throw new Error("illegal_transition");
    }
    this.s.status = "failed";
  }

  markCancelled(): void {
    if (this.s.status !== "pending" && this.s.status !== "requires_action") {
      throw new Error("illegal_transition");
    }
    this.s.status = "cancelled";
  }

  markApproved(params: { providerPaymentId: string; approvedAmountCents: number }): void {
    if (this.s.status !== "pending" && this.s.status !== "requires_action") {
      throw new Error("illegal_transition");
    }
    if (params.approvedAmountCents !== this.s.amountCents) {
      throw new Error("illegal_transition");
    }
    this.s.providerPaymentId = params.providerPaymentId.trim();
    this.s.approvedAmountCents = params.approvedAmountCents;
    this.s.status = "approved";
  }

  markRefunded(): void {
    if (this.s.status !== "approved") throw new Error("illegal_transition");
    this.s.status = "refunded";
  }
}
