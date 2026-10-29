import type { Prisma } from "@prisma/client";
import type { DomainEventEnvelope } from "@zyon/shared-types";

type OutboxTransactionClient = Pick<Prisma.TransactionClient, "outboxMessage">;

/** Writes a durable outbox event through the caller's existing transaction. */
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
