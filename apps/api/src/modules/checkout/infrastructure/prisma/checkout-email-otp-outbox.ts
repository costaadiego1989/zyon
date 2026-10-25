import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { checkoutEmailOtpDeliveryScopeSchema, checkoutEmailOtpDeliveryOutcomeSchema } from "../../domain/services/checkout-email-otp-delivery.schemas.js";

export const CHECKOUT_EMAIL_OTP_DELIVERY_EVENT = "checkout.email_otp.delivery.requested";
const id = checkoutEmailOtpDeliveryScopeSchema.shape.merchantId;
const referenceSchema = checkoutEmailOtpDeliveryScopeSchema.extend({ deliveryId: z.uuid(), acceptanceEventId: id,
  issuedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
}).refine(value => Date.parse(value.expiresAt) - Date.parse(value.issuedAt) === 600_000);
export { referenceSchema as checkoutEmailOtpDeliveryReferenceSchema };
const payload = (reference: z.infer<typeof referenceSchema>) => ({ version: 1, sessionId: reference.sessionId,
  deliveryId: reference.deliveryId, acceptanceEventId: reference.acceptanceEventId,
  issuedAt: reference.issuedAt, expiresAt: reference.expiresAt });
const rowSchema = z.object({ eventId: z.uuid(), eventType: z.literal(CHECKOUT_EMAIL_OTP_DELIVERY_EVENT), schemaVersion: z.literal(1),
  merchantId: id, occurredAt: z.date(), correlationId: id, causationId: id, producer: z.literal("checkout"), payload: z.unknown(),
  status: z.enum(["otp_pending", "otp_sending", "otp_sent", "otp_unknown", "otp_cancelled"]),
  attempts: z.number().int().min(0).max(1), leaseToken: z.uuid().nullable(), leaseExpiresAt: z.null(),
});
type Tx = Pick<Prisma.TransactionClient, "outboxMessage" | "$queryRaw">;
const review = (): never => { throw new Error("checkout_email_otp_review_required"); };

/** Transaction-only persistence primitives. The accepted-checkout adapter MUST
 * have locked/revalidated scope/receipt/customer/challenge/version/payment first.
 * Reference JSON and these helpers alone are NOT permission to issue/send OTP.
 * Private statuses deliberately cannot be claimed by the generic retry relay. */
export async function appendCheckoutEmailOtpDelivery(tx: Tx, rawReference: unknown): Promise<void> {
  const reference = referenceSchema.parse(rawReference);
  await tx.outboxMessage.create({ data: { eventId: reference.deliveryId, eventType: CHECKOUT_EMAIL_OTP_DELIVERY_EVENT,
    schemaVersion: 1, merchantId: reference.merchantId, occurredAt: new Date(reference.issuedAt),
    correlationId: reference.sessionId, causationId: reference.acceptanceEventId, producer: "checkout",
    payload: payload(reference), status: "otp_pending", attempts: 0, leaseToken: null, leaseExpiresAt: null,
  } });
}

async function lockedReference(tx: Tx, rawReference: unknown) {
  const reference = referenceSchema.parse(rawReference);
  await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE merchant_id=${reference.merchantId}
    AND event_id=${reference.deliveryId} AND payload->>'sessionId'=${reference.sessionId} FOR UPDATE`;
  const parsed = rowSchema.safeParse(await tx.outboxMessage.findFirst({ where: { merchantId: reference.merchantId, eventId: reference.deliveryId } }));
  if (!parsed.success) return review();
  const row = parsed.data;
  // Keep the immutable payload reference-only; provider acceptance is status+time.
  if (row.eventId !== reference.deliveryId || row.merchantId !== reference.merchantId
    || row.correlationId !== reference.sessionId || row.causationId !== reference.acceptanceEventId
    || row.occurredAt.getTime() !== Date.parse(reference.issuedAt) || !isDeepStrictEqual(row.payload, payload(reference))
    || row.status === "otp_pending" && (row.attempts !== 0 || row.leaseToken !== null)
    || row.status === "otp_sending" && (row.attempts !== 1 || !row.leaseToken)
    || ["otp_sent", "otp_unknown"].includes(row.status) && (row.attempts !== 1 || row.leaseToken !== null)
    || row.status === "otp_cancelled" && (row.attempts !== 0 || row.leaseToken !== null)) return review();
  return { reference, row };
}

/** Read an existing, locked technical reference. This cannot establish current
 * email/challenge/version authority; that belongs to the accepted adapter. */
export async function inspectCheckoutEmailOtpDelivery(tx: Tx, rawScope: unknown, rawDeliveryId: unknown, rawAcceptanceEventId: unknown) {
  const scope = checkoutEmailOtpDeliveryScopeSchema.parse(rawScope), deliveryId = z.uuid().parse(rawDeliveryId), acceptanceEventId = id.parse(rawAcceptanceEventId);
  await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE merchant_id=${scope.merchantId}
    AND event_id=${deliveryId} AND payload->>'sessionId'=${scope.sessionId} FOR UPDATE`;
  const row = z.object({ payload: z.strictObject({ version: z.literal(1), sessionId: id, deliveryId: z.uuid(), acceptanceEventId: id,
    issuedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
  }) }).parse(await tx.outboxMessage.findFirst({ where: { merchantId: scope.merchantId, eventId: deliveryId } }));
  const { version: _version, ...technical } = row.payload;
  const reference = referenceSchema.parse({ ...technical, merchantId: scope.merchantId });
  if (reference.sessionId !== scope.sessionId || reference.deliveryId !== deliveryId || reference.acceptanceEventId !== acceptanceEventId) return review();
  return lockedReference(tx, reference);
}

export async function claimCheckoutEmailOtpDelivery(tx: Tx, rawReference: unknown, now: Date): Promise<
  { status: "claimed"; claimToken: string } | { status: "sent" | "unknown" | "cancelled" }> {
  const { reference, row } = await lockedReference(tx, rawReference);
  if (!Number.isFinite(now.getTime()) || now.getTime() < Date.parse(reference.issuedAt)) return review();
  if (row.status !== "otp_pending") return { status: row.status === "otp_sent" ? "sent" : row.status === "otp_cancelled" ? "cancelled" : "unknown" };
  if (Date.parse(reference.expiresAt) <= now.getTime()) {
    await cancelPending(tx, reference); return { status: "cancelled" };
  }
  const claimToken = randomUUID();
  const changed = await tx.outboxMessage.updateMany({ where: { eventId: reference.deliveryId, merchantId: reference.merchantId,
    eventType: CHECKOUT_EMAIL_OTP_DELIVERY_EVENT, status: "otp_pending", attempts: 0, leaseToken: null },
  data: { status: "otp_sending", attempts: 1, leaseToken: claimToken, leaseExpiresAt: null } });
  if (changed.count !== 1) return review();
  return { status: "claimed", claimToken };
}

/** Explicit replacement may cancel only a delivery never dispatched. Sending /
 * unknown must be reviewed, never erased, reset, reclaimed or replayed here. */
export async function invalidatePendingCheckoutEmailOtpDelivery(tx: Tx, rawReference: unknown): Promise<"cancelled" | "sent"> {
  const { reference, row } = await lockedReference(tx, rawReference);
  if (row.status === "otp_sent") return "sent";
  if (row.status === "otp_cancelled") return "cancelled";
  if (row.status !== "otp_pending") return review();
  await cancelPending(tx, reference); return "cancelled";
}

async function cancelPending(tx: Tx, reference: z.infer<typeof referenceSchema>) {
  const changed = await tx.outboxMessage.updateMany({ where: { eventId: reference.deliveryId, merchantId: reference.merchantId,
    eventType: CHECKOUT_EMAIL_OTP_DELIVERY_EVENT, status: "otp_pending", attempts: 0, leaseToken: null },
  data: { status: "otp_cancelled", lastError: "checkout_email_otp_superseded_or_expired" } });
  if (changed.count !== 1) return review();
}

export async function completeCheckoutEmailOtpDelivery(tx: Tx, rawReference: unknown, rawToken: unknown, rawOutcome: unknown, now: Date): Promise<"sent" | "unknown"> {
  const { reference, row } = await lockedReference(tx, rawReference);
  const claimToken = z.uuid().parse(rawToken), outcome = checkoutEmailOtpDeliveryOutcomeSchema.parse(rawOutcome);
  if (!Number.isFinite(now.getTime()) || now.getTime() < Date.parse(reference.issuedAt)
    || row.status !== "otp_sending" || row.leaseToken !== claimToken || row.attempts !== 1) return review();
  const changed = await tx.outboxMessage.updateMany({ where: { eventId: reference.deliveryId, merchantId: reference.merchantId,
    eventType: CHECKOUT_EMAIL_OTP_DELIVERY_EVENT, status: "otp_sending", attempts: 1, leaseToken: claimToken },
  data: { status: outcome.status === "sent" ? "otp_sent" : "otp_unknown", leaseToken: null, leaseExpiresAt: null,
    deliveredAt: outcome.status === "sent" ? now : null, lastError: outcome.status === "unknown" ? "provider_acceptance_unknown" : null } });
  if (changed.count !== 1) return review();
  return outcome.status;
}
