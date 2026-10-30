import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { INFORMATIONAL_EVENT_AUDIT_HANDLERS, informationalEventRedriveInputSchema,
  type InformationalEventRedriveInput, type InformationalEventRedrivePort,
  type InformationalEventRedriveResult } from "../ports/informational-event-redrive.port.js";
import { OUTBOX_MAX_ATTEMPTS } from "../ports/outbox.repository.port.js";

const id = z.string().min(1).max(191);
const quotePayload = z.object({ quote_id: id, session_id: id, merchant_id: id.optional(),
  option_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), expires_at: z.string().datetime() });
const shipmentPayload = z.object({ shipment_id: id, order_id: id, merchant_id: id, carrier_key: id });
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function fingerprint(row: { eventId: string; eventType: string; schemaVersion: number; merchantId: string; occurredAt: Date; createdAt: Date;
  correlationId: string; causationId: string; producer: string; payload: unknown }): string {
  return createHash("sha256").update(canonical({ eventId: row.eventId, eventType: row.eventType, schemaVersion: row.schemaVersion,
    merchantId: row.merchantId, occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString(), correlationId: row.correlationId,
    causationId: row.causationId, producer: row.producer, payload: row.payload })).digest("hex");
}

/** One bounded recovery budget per original event, guarded by an immutable audit.
 * Neither event envelopes nor handler execution receipts are rewritten. */
export class PrismaInformationalEventRedriveAdapter implements InformationalEventRedrivePort {
  constructor(private readonly prisma: PrismaClient) {}

  async redrive(raw: InformationalEventRedriveInput, handlerIds: readonly string[]): Promise<InformationalEventRedriveResult> {
    const input = informationalEventRedriveInputSchema.parse(raw);
    if (handlerIds.length !== 1 || handlerIds[0] !== INFORMATIONAL_EVENT_AUDIT_HANDLERS[input.expectedEventType])
      throw Error("informational_redrive_handlers_unconfirmed");
    const auditId = "outbox-redrive:" + createHash("sha256").update(`${input.merchantId}\0${input.eventId}\0v1`).digest("hex");
    return this.prisma.$transaction(async (tx): Promise<InformationalEventRedriveResult> => {
      // Serialize duplicate operational requests and fence the normal worker.
      const locked = await tx.$queryRaw<Array<{ eventId: string }>>(Prisma.sql`
        SELECT "event_id" AS "eventId" FROM "outbox_messages"
        WHERE "event_id" = ${input.eventId} AND "merchant_id" = ${input.merchantId} FOR UPDATE
      `);
      if (locked.length !== 1) throw Error("informational_redrive_event_not_found");
      const row = await tx.outboxMessage.findFirst({ where: { eventId: input.eventId, merchantId: input.merchantId } });
      if (!row || row.eventType !== input.expectedEventType || row.schemaVersion !== 1
        || row.producer !== (row.eventType === "shipment.created" ? "fulfillment" : "shipping"))
        throw Error("informational_redrive_event_scope_mismatch");
      const payload = (row.eventType === "shipment.created" ? shipmentPayload : quotePayload).parse(row.payload);
      id.parse(row.correlationId); id.parse(row.causationId);
      if (payload.merchant_id !== undefined && payload.merchant_id !== input.merchantId)
        throw Error("informational_redrive_payload_tenant_mismatch");
      const envelopeFingerprint = fingerprint(row);
      const audit = await tx.merchantAuditEvent.findUnique({ where: { id: auditId } });
      if (audit) {
        const metadata = audit.metadata as Record<string, unknown>;
        if (audit.merchantId !== input.merchantId || audit.resourceId !== row.eventId || audit.action !== "outbox.informational.redrive"
          || metadata?.envelopeFingerprint !== envelopeFingerprint || metadata?.version !== 1)
          throw Error("informational_redrive_audit_mismatch");
        return { eventId: row.eventId, auditId, outcome: row.status === "delivered" ? "already_delivered" : "already_requested" };
      }
      if (row.status === "delivered") return { eventId: row.eventId, outcome: "already_delivered" };
      if (row.status !== "dead" || row.attempts !== OUTBOX_MAX_ATTEMPTS || row.lastError !== "outbox_handler_missing"
        || row.leaseToken !== null || row.leaseExpiresAt !== null || row.deliveredAt !== null)
        throw Error("informational_redrive_state_not_eligible");
      const updated = await tx.outboxMessage.updateMany({
        where: { eventId: row.eventId, merchantId: row.merchantId, eventType: row.eventType, schemaVersion: 1,
          producer: row.producer, status: "dead", attempts: OUTBOX_MAX_ATTEMPTS, lastError: "outbox_handler_missing",
          leaseToken: null, leaseExpiresAt: null, deliveredAt: null, nextAttemptAt: row.nextAttemptAt,
          occurredAt: row.occurredAt, createdAt: row.createdAt, correlationId: row.correlationId, causationId: row.causationId,
          payload: { equals: row.payload as Prisma.InputJsonValue } },
        data: { status: "pending", attempts: 0, lastError: null, nextAttemptAt: new Date() },
      });
      if (updated.count !== 1) throw Error("informational_redrive_conflict");
      // A failed audit rolls the queue CAS back in this same transaction.
      await tx.merchantAuditEvent.create({ data: {
        id: auditId, merchantId: input.merchantId, actorType: "operator", actorId: input.actorId,
        action: "outbox.informational.redrive", resourceType: "outbox_event", resourceId: row.eventId,
        correlationId: row.correlationId, outcome: "success",
        metadata: { version: 1, purpose: input.purpose, eventType: row.eventType, schemaVersion: row.schemaVersion,
          envelopeFingerprint, priorStatus: row.status, priorAttempts: row.attempts, priorLastError: row.lastError,
          priorNextAttemptAt: row.nextAttemptAt?.toISOString() ?? null, priorDeliveredAt: null, priorLeaseToken: null,
          priorLeaseExpiresAt: null, grantedRetryBudget: OUTBOX_MAX_ATTEMPTS, handlerIds: [...handlerIds] },
      } });
      return { eventId: row.eventId, auditId, outcome: "requeued" };
    }, { isolationLevel: "ReadCommitted", timeout: 15000 });
  }
}
