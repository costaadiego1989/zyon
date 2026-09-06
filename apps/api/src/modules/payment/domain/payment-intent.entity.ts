import { randomUUID } from "node:crypto";
import { assertPaymentAmount, type PaymentAmountBreakdown } from "./payment-amount.js";
import type { CreateProviderPaymentInput } from "./ports/payment-provider.port.js";

export type PaymentCreation = {
  state: "ready" | "in_flight" | "uncertain" | "complete";
  input: CreateProviderPaymentInput;
  leaseToken?: string;
  leaseUntil?: string;
  firstAttemptAt?: string;
  reason?: string;
};

const FORBIDDEN_PAYMENT_INPUT_KEYS = ["unsafeRawCardPan", "cvv", "cardNumber", "rawPan", "pan"] as const;

export type PaymentMethod = "pix" | "card" | "boleto" | "crypto";

export type PaymentIntentStatus =
  | "pending"
  | "requires_action"
  | "approved"
  | "failed"
  | "cancelled"
  | "refunded";

export type PaymentIntentStatusHistoryEntry = {
  status: PaymentIntentStatus;
  occurredAt: string;
  reason?: string;
};

export type PaymentIntentCreateInput = {
  merchantId: string;
  sessionId: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  acceptedOfferId?: string;
  commerceOrderId?: string;
  amountBreakdown?: PaymentAmountBreakdown;
};

export type PaymentIntentSnapshot = {
  version?: number;
  amountBreakdown?: PaymentAmountBreakdown;
  creation?: PaymentCreation;
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
  commerceOrderId?: string;
  buyerFacing?: {
    qrCodeCopyPaste?: string;
    invoiceUrl?: string;
    encodedQrImage?: string;
    clientSecret?: string;
    stripePublishableKey?: string;
    chainId?: number;
    chain?: string;
    evmNetwork?: string;
    chainLabel?: string;
    tokenAddress?: string;
    tokenSymbol?: string;
    amountAtomic?: string;
    amountDisplay?: string;
    destinationAddress?: string;
    transfers?: Array<{
      kind: "merchant" | "platform_fee";
      destinationAddress: string;
      amountAtomic: string;
      amountDisplay: string;
    }>;
    quoteExpiresAt?: string;
    walletConnectProjectId?: string;
  };
  statusHistory: PaymentIntentStatusHistoryEntry[];
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
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("payment_intent_amount_invalid");
    if (!input.currency.trim()) throw new Error("payment_intent_currency_invalid");
    if (input.amountBreakdown) assertPaymentAmount(input.amountBreakdown, input.amountCents, input.currency.trim().toUpperCase());

    const acceptedOfferId =
      typeof input.acceptedOfferId === "string" ? input.acceptedOfferId.trim() || undefined : undefined;
    const commerceOrderId =
      typeof input.commerceOrderId === "string" ? input.commerceOrderId.trim() || undefined : undefined;

    return new PaymentIntentEntity({
      id: `pay_int_${randomUUID()}`,
      version: 0,
      amountBreakdown: input.amountBreakdown ? structuredClone(input.amountBreakdown) : undefined,
      merchantId,
      sessionId,
      idempotencyKey,
      amountCents: input.amountCents,
      currency: input.currency.trim().toUpperCase(),
      method: input.method,
      status: "pending",
      acceptedOfferId,
      commerceOrderId,
      statusHistory: [{ status: "pending", occurredAt: new Date().toISOString() }]
    });
  }

  static rehydrate(snapshot: PaymentIntentSnapshot): PaymentIntentEntity {
    return new PaymentIntentEntity({
      ...structuredClone(snapshot),
      version: snapshot.version ?? 0,
      statusHistory: snapshot.statusHistory ?? [
        { status: snapshot.status, occurredAt: new Date().toISOString() }
      ]
    });
  }

  snapshot(): PaymentIntentSnapshot {
    return structuredClone(this.s);
  }

  persisted(version: number): void { this.s.version = version; }

  prepareCreation(input: CreateProviderPaymentInput): void {
    if (this.s.creation || this.s.providerPaymentId || input.creditCard || input.creditCardHolderInfo || input.remoteIp) throw new Error("payment_creation_input_invalid");
    if (input.intentId !== this.s.id || input.amountCents !== this.s.amountCents || input.merchantId !== this.s.merchantId || input.sessionId !== this.s.sessionId || input.currency !== this.s.currency) throw new Error("payment_creation_input_invalid");
    this.s.creation = { state: "ready", input: structuredClone(input) };
  }

  claimCreation(token: string, now: Date, leaseMs = 60_000): "create" | "recover" | null {
    const creation = this.s.creation;
    if (!creation || creation.state === "complete" || this.s.providerPaymentId || this.s.status !== "pending") return null;
    if (creation.leaseUntil && Date.parse(creation.leaseUntil) > now.getTime()) return null;
    const action = creation.state === "ready" ? "create" : "recover";
    this.s.creation = { ...creation, state: "in_flight", leaseToken: token, leaseUntil: new Date(now.getTime() + leaseMs).toISOString(), firstAttemptAt: creation.firstAttemptAt ?? now.toISOString() };
    return action;
  }

  markCreationUncertain(token: string, reason: string): void {
    if (this.s.creation?.leaseToken !== token) throw new Error("payment_creation_lease_lost");
    this.s.creation = { ...this.s.creation, state: "uncertain", leaseToken: undefined, leaseUntil: undefined, reason };
  }

  completeCreation(token: string): void {
    if (this.s.creation?.leaseToken !== token) throw new Error("payment_creation_lease_lost");
    this.s.creation = { ...this.s.creation, state: "complete", leaseToken: undefined, leaseUntil: undefined, reason: undefined };
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
    this.pushStatus("requires_action");
  }

  setBuyerFacingPayload(payload: NonNullable<PaymentIntentSnapshot["buyerFacing"]>): void {
    if (this.s.status !== "pending" && this.s.status !== "requires_action") {
      throw new Error("illegal_transition");
    }
    this.s.buyerFacing = { ...payload };
  }

  markFailed(reason?: string): void {
    if (this.s.status !== "pending" && this.s.status !== "requires_action") {
      throw new Error("illegal_transition");
    }
    this.s.status = "failed";
    this.pushStatus("failed", reason);
  }

  markCancelled(reason?: string): void {
    if (this.s.status !== "pending" && this.s.status !== "requires_action") {
      throw new Error("illegal_transition");
    }
    this.s.status = "cancelled";
    this.pushStatus("cancelled", reason);
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
    this.pushStatus("approved");
  }

  markRefunded(reason?: string): void {
    if (this.s.status !== "approved") throw new Error("illegal_transition");
    this.s.status = "refunded";
    this.pushStatus("refunded", reason);
  }

  private pushStatus(status: PaymentIntentStatus, reason?: string): void {
    this.s.statusHistory = [
      ...(this.s.statusHistory ?? []),
      { status, occurredAt: new Date().toISOString(), ...(reason ? { reason } : {}) }
    ];
  }
}
