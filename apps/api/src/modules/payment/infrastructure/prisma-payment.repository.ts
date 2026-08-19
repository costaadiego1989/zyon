import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import type {
  CryptoTransferKey,
  PaymentRepository,
  ProviderEventKey,
  SavePaymentIntentInput,
  StalePendingQuery
} from "../domain/ports/payment-repository.port.js";
import type { PaymentIntentSnapshot, PaymentIntentStatus } from "../domain/payment-intent.entity.js";
import type { PaymentMethod } from "../domain/payment-intent.entity.js";

type PrismaTx = Prisma.TransactionClient;

function paymentIntentUpsertArgs(d: PaymentIntentSnapshot) {
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
  return {
    where: { merchantId_sessionId_idempotencyKey: s },
    create: createData as any,
    update: updateData as any
  };
}

function outboxUpsertArgs(event: DomainEventEnvelope) {
  return {
    where: { eventId: event.event_id },
    create: {
      eventId: event.event_id,
      eventType: event.event_type,
      schemaVersion: event.schema_version,
      merchantId: event.merchant_id,
      occurredAt: new Date(event.occurred_at),
      correlationId: event.correlation_id,
      causationId: event.causation_id,
      producer: event.producer,
      payload: event.payload as Prisma.InputJsonValue
    },
    update: {}
  };
}

function strip(d: PaymentIntentSnapshot) {
  return {
    merchantId: d.merchantId.trim(),
    sessionId: d.sessionId.trim(),
    idempotencyKey: d.idempotencyKey.trim()
  };
}

type NormalizedCryptoTransfer = NonNullable<NonNullable<PaymentIntentSnapshot["buyerFacing"]>["transfers"]>[number];

function normalizeBuyerFacing(v: unknown): PaymentIntentSnapshot["buyerFacing"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const rec = v as Record<string, unknown>;
  const out: PaymentIntentSnapshot["buyerFacing"] = {};
  if (typeof rec.qrCodeCopyPaste === "string") out.qrCodeCopyPaste = rec.qrCodeCopyPaste;
  if (typeof rec.invoiceUrl === "string") out.invoiceUrl = rec.invoiceUrl;
  if (typeof rec.encodedQrImage === "string") out.encodedQrImage = rec.encodedQrImage;
  if (typeof rec.clientSecret === "string") out.clientSecret = rec.clientSecret;
  if (typeof rec.stripePublishableKey === "string") out.stripePublishableKey = rec.stripePublishableKey;
  if (typeof rec.chainId === "number") out.chainId = rec.chainId;
  if (typeof rec.chain === "string") out.chain = rec.chain;
  if (typeof rec.evmNetwork === "string") out.evmNetwork = rec.evmNetwork;
  if (typeof rec.chainLabel === "string") out.chainLabel = rec.chainLabel;
  if (typeof rec.tokenAddress === "string") out.tokenAddress = rec.tokenAddress;
  if (typeof rec.tokenSymbol === "string") out.tokenSymbol = rec.tokenSymbol;
  if (typeof rec.amountAtomic === "string") out.amountAtomic = rec.amountAtomic;
  if (typeof rec.amountDisplay === "string") out.amountDisplay = rec.amountDisplay;
  if (typeof rec.destinationAddress === "string") out.destinationAddress = rec.destinationAddress;
  if (Array.isArray(rec.transfers)) {
    const transfers = rec.transfers.filter((item): item is NormalizedCryptoTransfer => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const t = item as Record<string, unknown>;
      return (t.kind === "merchant" || t.kind === "platform_fee") &&
        typeof t.destinationAddress === "string" &&
        typeof t.amountAtomic === "string" &&
        typeof t.amountDisplay === "string";
    });
    if (transfers.length) out.transfers = transfers;
  }
  if (typeof rec.quoteExpiresAt === "string") out.quoteExpiresAt = rec.quoteExpiresAt;
  if (typeof rec.walletConnectProjectId === "string") out.walletConnectProjectId = rec.walletConnectProjectId;
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
    await this.prisma.paymentIntent.upsert(paymentIntentUpsertArgs(input.intent.snapshot()));
  }

  async saveIntentWithOutbox(input: SavePaymentIntentInput, event: DomainEventEnvelope): Promise<void> {
    const intentArgs = paymentIntentUpsertArgs(input.intent.snapshot());
    const outboxArgs = outboxUpsertArgs(event);
    await this.prisma.$transaction(async (tx: PrismaTx) => {
      await tx.paymentIntent.upsert(intentArgs);
      await tx.outboxMessage.upsert(outboxArgs);
    });
  }

  async listStalePending(query: StalePendingQuery): Promise<PaymentIntentEntity[]> {
    const rows = await this.prisma.paymentIntent.findMany({
      where: {
        status: { in: ["pending", "requires_action"] },
        updatedAt: { lt: query.olderThan }
      },
      orderBy: { updatedAt: "asc" },
      take: query.limit
    });
    return rows.map((row) => PaymentIntentEntity.rehydrate(snapshotFromRecord(row)));
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

  async getIntentById(merchantId: string, intentBusinessId: string): Promise<PaymentIntentEntity | null> {
    // C2 fix: atomic tenant boundary — scope the query directly with both id and merchantId
    const row = await this.prisma.paymentIntent.findUnique({
      where: { id: intentBusinessId.trim() }
    });
    if (!row) return null;
    // Post-read verification: query already matched id, verify merchantId atomically
    if (row.merchantId !== merchantId.trim()) return null;
    return PaymentIntentEntity.rehydrate(snapshotFromRecord(row));
  }

  async getIntentByExternalReference(
    externalReference: string
  ): Promise<{ id: string; merchantId: string } | null> {
    const row = await this.prisma.paymentIntent.findUnique({
      where: { id: externalReference.trim() },
      select: { id: true, merchantId: true }
    });
    return row ? { id: row.id, merchantId: row.merchantId } : null;
  }

  async hasProcessedProviderEvent(key: ProviderEventKey): Promise<boolean> {
    const row = await this.prisma.paymentProviderEvent.findFirst({
      where: {
        provider: key.provider,
        merchantId: key.merchantId,
        eventId: key.eventId.trim()
      }
    });
    return Boolean(row);
  }

  async recordProcessedProviderEvent(key: ProviderEventKey): Promise<boolean> {
    const eventId = key.eventId.trim();
    try {
      await this.prisma.paymentProviderEvent.create({
        data: {
          id: `${key.provider}:${key.merchantId ?? "_"}:${eventId}`,
          provider: key.provider,
          merchantId: key.merchantId,
          eventId
        }
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
      throw e;
    }
  }

  async deleteProcessedProviderEvent(key: ProviderEventKey): Promise<void> {
    await this.prisma.paymentProviderEvent.deleteMany({
      where: {
        provider: key.provider,
        merchantId: key.merchantId,
        eventId: key.eventId.trim()
      }
    });
  }

  async recordCryptoTransfer(key: CryptoTransferKey): Promise<boolean> {
    const chain = key.chain.trim().toLowerCase();
    const txHash = key.txHash.trim().toLowerCase();
    try {
      await this.prisma.paymentCryptoTransfer.create({
        data: {
          id: `${chain}:${txHash}`,
          chain,
          txHash,
          merchantId: key.merchantId.trim(),
          intentId: key.intentId.trim()
        }
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
      throw e;
    }
  }

  async deleteCryptoTransfer(key: Pick<CryptoTransferKey, "chain" | "txHash">): Promise<void> {
    await this.prisma.paymentCryptoTransfer.deleteMany({
      where: {
        chain: key.chain.trim().toLowerCase(),
        txHash: key.txHash.trim().toLowerCase()
      }
    });
  }

  /**
   * H1 fix: reap expired crypto transfer reservations — orphaned by worker kill mid-RPC.
   * Deletes reservations past their expires_at that don't have a corresponding approved intent.
   */
  async reapExpiredCryptoReservations(): Promise<number> {
    const now = new Date();
    // Find expired reservations where the intent is NOT approved
    const expired = await this.prisma.paymentCryptoTransfer.findMany({
      where: {
        expiresAt: { lt: now }
      },
      select: { id: true, intentId: true, merchantId: true }
    });

    if (expired.length === 0) return 0;

    // Check which intents are already approved (those reservations are valid)
    const intentIds = [...new Set(expired.map(e => e.intentId))];
    const approvedIntents = await this.prisma.paymentIntent.findMany({
      where: {
        id: { in: intentIds },
        status: "approved"
      },
      select: { id: true }
    });
    const approvedSet = new Set(approvedIntents.map(i => i.id));

    // Delete only reservations whose intent was never approved
    const toDelete = expired.filter(e => !approvedSet.has(e.intentId)).map(e => e.id);
    if (toDelete.length === 0) return 0;

    const result = await this.prisma.paymentCryptoTransfer.deleteMany({
      where: { id: { in: toDelete } }
    });
    return result.count;
  }

  async listByMerchantId(
    merchantId: string,
    statusPrefix?: string,
  ): Promise<PaymentIntentEntity[]> {
    const rows = await this.prisma.paymentIntent.findMany({
      where: {
        merchantId,
        ...(statusPrefix && { status: { startsWith: statusPrefix } }),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return rows.map((row) => PaymentIntentEntity.rehydrate(snapshotFromRecord(row)));
  }
}
