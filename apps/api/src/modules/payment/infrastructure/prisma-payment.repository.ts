import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import type { PaymentRepository, SavePaymentIntentInput } from "../domain/ports/payment-repository.port.js";
import type { PaymentIntentSnapshot, PaymentIntentStatus } from "../domain/payment-intent.entity.js";
import type { PaymentMethod } from "../domain/payment-intent.entity.js";

function strip(d: PaymentIntentSnapshot) {
  return {
    merchantId: d.merchantId.trim(),
    sessionId: d.sessionId.trim(),
    idempotencyKey: d.idempotencyKey.trim()
  };
}

function normalizeBuyerFacing(v: unknown): PaymentIntentSnapshot["buyerFacing"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const rec = v as Record<string, unknown>;
  const out: PaymentIntentSnapshot["buyerFacing"] = {};
  if (typeof rec.qrCodeCopyPaste === "string") out.qrCodeCopyPaste = rec.qrCodeCopyPaste;
  if (typeof rec.invoiceUrl === "string") out.invoiceUrl = rec.invoiceUrl;
  if (typeof rec.encodedQrImage === "string") out.encodedQrImage = rec.encodedQrImage;
  return Object.keys(out).length ? out : undefined;
}

function snapshotFromRecord(row: {
  id: string;
  merchantId: string;
  sessionId: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  method: string;
  status: string;
  providerPaymentId: string | null;
  approvedAmountCents: number | null;
  acceptedOfferId: string | null;
  commerceOrderId?: string | null;
  buyerFacing: unknown;
  statusHistory?: unknown;
}): PaymentIntentSnapshot {
  return {
    id: row.id,
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    idempotencyKey: row.idempotencyKey,
    amountCents: row.amountCents,
    currency: row.currency,
    method: row.method as PaymentMethod,
    status: row.status as PaymentIntentStatus,
    providerPaymentId: row.providerPaymentId ?? undefined,
    approvedAmountCents: row.approvedAmountCents ?? undefined,
    acceptedOfferId: row.acceptedOfferId ?? undefined,
    commerceOrderId: row.commerceOrderId ?? undefined,
    buyerFacing: normalizeBuyerFacing(row.buyerFacing),
    statusHistory: Array.isArray(row.statusHistory)
      ? (row.statusHistory as PaymentIntentSnapshot["statusHistory"])
      : [{ status: row.status as PaymentIntentStatus, occurredAt: new Date().toISOString() }]
  };
}

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveIntent(input: SavePaymentIntentInput): Promise<void> {
    const d = input.intent.snapshot();
    const s = strip(d);
    const createData = {
      id: d.id,
      merchantId: s.merchantId,
      sessionId: s.sessionId,
      idempotencyKey: s.idempotencyKey,
      amountCents: d.amountCents,
      currency: d.currency,
      method: d.method,
      status: d.status,
      providerPaymentId: d.providerPaymentId ?? null,
      approvedAmountCents: d.approvedAmountCents ?? null,
      acceptedOfferId: d.acceptedOfferId ?? null,
      commerceOrderId: d.commerceOrderId ?? null,
      buyerFacing: d.buyerFacing ? (d.buyerFacing as Prisma.InputJsonValue) : Prisma.DbNull,
      statusHistory: d.statusHistory as unknown as Prisma.InputJsonValue
    };
    const updateData = {
      status: d.status,
      providerPaymentId: d.providerPaymentId ?? null,
      approvedAmountCents: d.approvedAmountCents ?? null,
      acceptedOfferId: d.acceptedOfferId ?? null,
      commerceOrderId: d.commerceOrderId ?? null,
      buyerFacing: d.buyerFacing ? (d.buyerFacing as Prisma.InputJsonValue) : Prisma.DbNull,
      statusHistory: d.statusHistory as unknown as Prisma.InputJsonValue,
      currency: d.currency,
      method: d.method,
      amountCents: d.amountCents
    };
    await this.prisma.paymentIntent.upsert({
      where: {
        merchantId_sessionId_idempotencyKey: s
      },
      create: createData as any,
      update: updateData as any
    });
  }

  async getByIdempotency(
    merchantId: string,
    sessionId: string,
    idempotencyKey: string
  ): Promise<PaymentIntentEntity | null> {
    const row = await this.prisma.paymentIntent.findUnique({
      where: {
        merchantId_sessionId_idempotencyKey: {
          merchantId: merchantId.trim(),
          sessionId: sessionId.trim(),
          idempotencyKey: idempotencyKey.trim()
        }
      }
    });
    return row ? PaymentIntentEntity.rehydrate(snapshotFromRecord(row)) : null;
  }

  async getByProviderPaymentId(
    merchantId: string,
    providerPaymentId: string
  ): Promise<PaymentIntentEntity | null> {
    const row = await this.prisma.paymentIntent.findFirst({
      where: {
        merchantId: merchantId.trim(),
        providerPaymentId: providerPaymentId.trim()
      }
    });
    return row ? PaymentIntentEntity.rehydrate(snapshotFromRecord(row)) : null;
  }

  async getIntentById(intentBusinessId: string): Promise<PaymentIntentEntity | null> {
    const row = await this.prisma.paymentIntent.findUnique({
      where: { id: intentBusinessId.trim() }
    });
    return row ? PaymentIntentEntity.rehydrate(snapshotFromRecord(row)) : null;
  }

  async hasProcessedProviderEvent(providerEventId: string): Promise<boolean> {
    const id = providerEventId.trim();
    const row = await this.prisma.paymentProviderEvent.findUnique({
      where: { id }
    });
    return Boolean(row);
  }

  async recordProcessedProviderEvent(providerEventId: string): Promise<boolean> {
    const id = providerEventId.trim();
    try {
      await this.prisma.paymentProviderEvent.create({ data: { id } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
      throw e;
    }
  }
}
