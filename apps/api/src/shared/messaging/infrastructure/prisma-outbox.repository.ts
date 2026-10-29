import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../persistence/persistence.module.js";
import {
  OUTBOX_LEASE_MS, OUTBOX_MAX_ATTEMPTS,
  type LeasedOutboxClaim, type LeasedOutboxRepository, type OutboxFailureOutcome,
  type OutboxTransaction, type TransactionalOutbox,
} from "../ports/outbox.repository.port.js";

interface OutboxRow {
  eventId: string; eventType: string; schemaVersion: number; merchantId: string;
  occurredAt: Date; correlationId: string; causationId: string; producer: string;
  payload: Prisma.JsonValue; attempts: number; leaseToken: string; leaseExpiresAt: Date;
}

const projection = Prisma.sql`
  "event_id" AS "eventId", "event_type" AS "eventType", "schema_version" AS "schemaVersion",
  "merchant_id" AS "merchantId", "occurred_at" AS "occurredAt", "correlation_id" AS "correlationId",
  "causation_id" AS "causationId", "producer", "payload", "attempts",
  "lease_token" AS "leaseToken", "lease_expires_at" AS "leaseExpiresAt"
`;

@Injectable()
export class PrismaOutboxRepository implements LeasedOutboxRepository, TransactionalOutbox {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async appendOutbox(event: DomainEventEnvelope): Promise<DomainEventEnvelope> {
    await appendOutboxOn(this.prisma, event);
    return event;
  }

  async listOutbox(merchantId: string): Promise<DomainEventEnvelope[]> {
    const rows = await this.prisma.outboxMessage.findMany({ where: { merchantId }, orderBy: { createdAt: "asc" } });
    return rows.map((row) => toEnvelope(row as unknown as OutboxRow));
  }

  /** Read-only inspection; never consumes a lease. */
  async listPending(batchSize = 50): Promise<DomainEventEnvelope[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { status: "pending", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      orderBy: [{ createdAt: "asc" }, { eventId: "asc" }], take: boundedBatchSize(batchSize),
    });
    return rows.map((row) => toEnvelope(row as unknown as OutboxRow));
  }

  async claimBatch(batchSize = 50): Promise<LeasedOutboxClaim[]> {
    const count = boundedBatchSize(batchSize);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "outbox_messages" SET "status" = 'dead', "lease_token" = NULL, "lease_expires_at" = NULL,
          "last_error" = 'outbox_attempts_exhausted', "next_attempt_at" = NULL
        WHERE "attempts" >= ${OUTBOX_MAX_ATTEMPTS} AND (
          "status" = 'pending' OR ("status" = 'processing' AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= NOW()))
        )
      `);
      const rows = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`
        WITH claimable AS (
          SELECT "event_id" AS id FROM "outbox_messages"
          WHERE "attempts" < ${OUTBOX_MAX_ATTEMPTS} AND (
            ("status" = 'pending' AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= NOW()))
            OR ("status" = 'processing' AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= NOW()))
          )
          ORDER BY "created_at", "event_id" LIMIT ${count} FOR UPDATE SKIP LOCKED
        )
        UPDATE "outbox_messages" SET "status" = 'processing', "lease_token" = ${randomUUID()},
          "lease_expires_at" = NOW() + ${OUTBOX_LEASE_MS} * INTERVAL '1 millisecond',
          "attempts" = "attempts" + 1
        FROM claimable WHERE "event_id" = claimable.id
        RETURNING ${projection}
      `);
      return rows.map((row) => ({ envelope: toEnvelope(row), attempts: row.attempts,
        leaseToken: row.leaseToken, leaseExpiresAt: row.leaseExpiresAt }));
    });
  }

  async renewClaim(claim: LeasedOutboxClaim): Promise<boolean> {
    return (await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "outbox_messages" SET "lease_expires_at" = NOW() + ${OUTBOX_LEASE_MS} * INTERVAL '1 millisecond'
      WHERE "event_id" = ${claim.envelope.event_id} AND "status" = 'processing'
        AND "lease_token" = ${claim.leaseToken} AND "lease_expires_at" > NOW()
    `)) === 1;
  }

  async releaseUnstartedClaim(claim: LeasedOutboxClaim): Promise<boolean> {
    return (await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "outbox_messages" SET "status" = 'pending', "lease_token" = NULL, "lease_expires_at" = NULL,
        "attempts" = GREATEST(0, "attempts" - 1)
      WHERE "event_id" = ${claim.envelope.event_id} AND "status" = 'processing'
        AND "lease_token" = ${claim.leaseToken} AND "lease_expires_at" > NOW()
    `)) === 1;
  }

  async getBacklog(): Promise<{ pending: number; processing: number; dead: number; oldestPendingAt: Date | null }> {
    const rows = await this.prisma.$queryRaw<Array<{ pending: number; processing: number; dead: number; oldestPendingAt: Date | null }>>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE "status" = 'pending')::integer AS pending,
        COUNT(*) FILTER (WHERE "status" = 'processing')::integer AS processing,
        COUNT(*) FILTER (WHERE "status" = 'dead')::integer AS dead,
        MIN("created_at") FILTER (WHERE "status" = 'pending') AS "oldestPendingAt"
      FROM "outbox_messages" WHERE "status" IN ('pending', 'processing', 'dead')
    `);
    return rows[0];
  }

  async completeClaim(claim: LeasedOutboxClaim): Promise<boolean> {
    return (await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "outbox_messages" SET "status" = 'delivered', "delivered_at" = NOW(), "published_at" = NOW(),
        "lease_token" = NULL, "lease_expires_at" = NULL, "next_attempt_at" = NULL, "last_error" = NULL
      WHERE "event_id" = ${claim.envelope.event_id} AND "status" = 'processing'
        AND "lease_token" = ${claim.leaseToken} AND "lease_expires_at" > NOW()
    `)) === 1;
  }

  async completeHandler(claim: LeasedOutboxClaim, handlerId: string): Promise<boolean> {
    // The event row lock serializes marker insertion against renewal/reclaim/ack.
    const count = await this.prisma.$executeRaw(Prisma.sql`
      WITH owned AS (
        SELECT "event_id" FROM "outbox_messages"
        WHERE "event_id" = ${claim.envelope.event_id} AND "status" = 'processing'
          AND "lease_token" = ${claim.leaseToken} AND "lease_expires_at" > NOW()
        FOR UPDATE
      )
      INSERT INTO "outbox_handler_executions" ("event_id", "handler_id", "processed_at")
        SELECT "event_id", ${handlerId}, NOW() FROM owned
      ON CONFLICT ("event_id", "handler_id") DO UPDATE
        SET "processed_at" = "outbox_handler_executions"."processed_at"
    `);
    return count === 1;
  }

  async failClaim(claim: LeasedOutboxClaim, errorCode: string, nextAttemptAt: Date): Promise<OutboxFailureOutcome | null> {
    const rows = await this.prisma.$queryRaw<Array<{ attempts: number; dead: boolean }>>(Prisma.sql`
      UPDATE "outbox_messages" SET
        "status" = CASE WHEN "attempts" >= ${OUTBOX_MAX_ATTEMPTS} THEN 'dead' ELSE 'pending' END,
        "next_attempt_at" = CASE WHEN "attempts" >= ${OUTBOX_MAX_ATTEMPTS} THEN NULL ELSE ${nextAttemptAt}::timestamp END,
        "last_error" = ${errorCode}, "lease_token" = NULL, "lease_expires_at" = NULL
      WHERE "event_id" = ${claim.envelope.event_id} AND "status" = 'processing'
        AND "lease_token" = ${claim.leaseToken} AND "lease_expires_at" > NOW()
      RETURNING "attempts", "status" = 'dead' AS dead
    `);
    return rows[0] ?? null;
  }

  async isProcessed(eventId: string): Promise<boolean> {
    return (await this.prisma.outboxMessage.findUnique({ where: { eventId }, select: { status: true } }))?.status === "delivered";
  }

  async isHandlerProcessed(eventId: string, handlerId: string): Promise<boolean> {
    return (await this.prisma.outboxHandlerExecution.findUnique({
      where: { eventId_handlerId: { eventId, handlerId } }, select: { eventId: true },
    })) !== null;
  }

  // Keep the producer adapter interface source-compatible, but no unfenced writes.
  async markDelivered(_eventId: string): Promise<void> { throw new Error("outbox_claim_required"); }
  async markFailed(_eventId: string, _error?: string): Promise<void> { throw new Error("outbox_claim_required"); }
  async markHandlerProcessed(_eventId: string, _handlerId: string): Promise<void> { throw new Error("outbox_claim_required"); }
  async recordFailure(_eventId: string, _error: string, _backoff: { maxAttempts: number; nextAttemptAt: Date }): Promise<OutboxFailureOutcome> {
    throw new Error("outbox_claim_required");
  }

  async saveWithOutbox<T>(work: (tx: OutboxTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => work({ appendOutbox: async (event) => {
      await appendOutboxOn(tx, event);
      return event;
    } }));
  }
}

function boundedBatchSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) throw new Error("outbox_batch_size_invalid");
  return value;
}

async function appendOutboxOn(client: Prisma.TransactionClient, event: DomainEventEnvelope): Promise<void> {
  await client.outboxMessage.upsert({
    where: { eventId: event.event_id },
    create: {
      eventId: event.event_id, eventType: event.event_type, schemaVersion: event.schema_version,
      merchantId: event.merchant_id, occurredAt: new Date(event.occurred_at), correlationId: event.correlation_id,
      causationId: event.causation_id, producer: event.producer, payload: event.payload as Prisma.InputJsonValue,
    }, update: {},
  });
}

function toEnvelope(row: OutboxRow): DomainEventEnvelope {
  return {
    event_id: row.eventId, event_type: row.eventType as DomainEventEnvelope["event_type"],
    schema_version: row.schemaVersion as DomainEventEnvelope["schema_version"],
    merchant_id: row.merchantId, occurred_at: row.occurredAt.toISOString(), correlation_id: row.correlationId,
    causation_id: row.causationId, producer: row.producer as DomainEventEnvelope["producer"],
    payload: row.payload as Record<string, unknown>,
  };
}
