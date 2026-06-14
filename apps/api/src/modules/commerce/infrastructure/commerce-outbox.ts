import type { Prisma } from "@prisma/client";
import type { DomainEventEnvelope } from "@aacp/shared-types";

type OutboxTransactionClient = Pick<Prisma.TransactionClient, "outboxMessage">;

/**
 * Appends a domain event to the durable outbox using the supplied transaction
 * client, so the event is committed atomically with the caller's aggregate
 * write. Idempotent on event_id (no-op if already present).
 */
export async function appendOutboxInTransaction(
  tx: OutboxTransactionClient,
  event: DomainEventEnvelope
): Promise<void> {
  await tx.outboxMessage.upsert({
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
}
