import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { DomainEventEnvelope } from "@aacp/shared-types";
import { PRISMA_CLIENT } from "../../persistence/persistence.module.js";
import type {
  OutboxClaim,
  OutboxRepository
} from "../ports/outbox.repository.port.js";

interface OutboxRow {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  merchantId: string;
  occurredAt: Date;
  correlationId: string;
  causationId: string;
  producer: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

@Injectable()
export class PrismaOutboxRepository implements OutboxRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async appendOutbox(event: DomainEventEnvelope): Promise<DomainEventEnvelope> {
    await this.prisma.outboxMessage.upsert({
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
    });
    return event;
  }

  async listOutbox(merchantId: string): Promise<DomainEventEnvelope[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { merchantId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => toEnvelope(row as unknown as OutboxRow));
  }

  async listPending(batchSize = 50): Promise<DomainEventEnvelope[]> {
    const claims = await this.claimBatch(batchSize);
    return claims.map((c) => c.envelope);
  }

  /**
   * Claims due pending rows with `FOR UPDATE SKIP LOCKED` so multiple dispatcher
   * instances never pick the same message. Runs in the same transaction the
   * raw query opens; the in-process dispatcher lock further serializes a single
   * instance.
   */
  async claimBatch(batchSize = 50): Promise<OutboxClaim[]> {
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      SELECT
        "event_id" AS "eventId",
        "event_type" AS "eventType",
        "schema_version" AS "schemaVersion",
        "merchant_id" AS "merchantId",
        "occurred_at" AS "occurredAt",
        "correlation_id" AS "correlationId",
        "causation_id" AS "causationId",
        "producer" AS "producer",
        "payload" AS "payload",
        "attempts" AS "attempts"
      FROM "outbox_messages"
      WHERE "status" = 'pending'
        AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= NOW())
      ORDER BY "created_at" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    return rows.map((row) => ({
      envelope: toEnvelope(row),
      attempts: row.attempts
    }));
  }

  async markDelivered(eventId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { eventId },
      data: { status: "delivered", deliveredAt: new Date(), publishedAt: new Date() }
    });
  }

  async markFailed(eventId: string, error?: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { eventId },
      data: { status: "failed", lastError: error ?? null }
    });
  }

  async recordFailure(
    eventId: string,
    error: string,
    backoff: { maxAttempts: number; nextAttemptAt: Date }
  ): Promise<{ attempts: number; dead: boolean }> {
    const current = await this.prisma.outboxMessage.findUnique({
      where: { eventId },
      select: { attempts: true }
    });
    const attempts = (current?.attempts ?? 0) + 1;
    const dead = attempts >= backoff.maxAttempts;
    await this.prisma.outboxMessage.update({
      where: { eventId },
      data: {
        attempts,
        lastError: error,
        status: dead ? "dead" : "pending",
        nextAttemptAt: dead ? null : backoff.nextAttemptAt
      }
    });
    return { attempts, dead };
  }

  async isProcessed(eventId: string): Promise<boolean> {
    const row = await this.prisma.outboxMessage.findUnique({
      where: { eventId },
      select: { status: true }
    });
    return row?.status === "delivered";
  }
}

function toEnvelope(row: OutboxRow): DomainEventEnvelope {
  return {
    event_id: row.eventId,
    event_type: row.eventType as DomainEventEnvelope["event_type"],
    schema_version: 1,
    merchant_id: row.merchantId,
    occurred_at: row.occurredAt.toISOString(),
    correlation_id: row.correlationId,
    causation_id: row.causationId,
    producer: row.producer as DomainEventEnvelope["producer"],
    payload: row.payload as Record<string, unknown>
  };
}
