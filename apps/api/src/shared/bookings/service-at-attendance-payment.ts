import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma, ServiceAppointment } from "@prisma/client";

/** Unpaid local balance, never an external provider approval. A replay cannot
 * reset an operator's later receipt or settlement. Caller retains the TX. */
export async function ensureAtAttendancePayment(tx: Prisma.TransactionClient, appointment: ServiceAppointment, now: Date) {
  const idempotencyKey = "at-attendance:" + appointment.id;
  const requestFingerprint = createHash("sha256").update(JSON.stringify(["at-attendance-v1", appointment.merchantId,
    appointment.id, appointment.priceInCents, appointment.currency])).digest("hex");
  const existing = await tx.appointmentPayment.findUnique({ where: { merchantId_idempotencyKey: {
    merchantId: appointment.merchantId, idempotencyKey,
  } } });
  if (existing) {
    if (existing.appointmentId !== appointment.id || existing.requestFingerprint !== requestFingerprint
      || existing.mode !== "at_attendance" || existing.amountCents !== appointment.priceInCents || existing.currency !== appointment.currency)
      throw new ConflictException("service_local_payment_conflict");
    return existing;
  }
  return tx.appointmentPayment.create({ data: { merchantId: appointment.merchantId, appointmentId: appointment.id,
    mode: "at_attendance", amountCents: appointment.priceInCents, currency: appointment.currency,
    status: "pending", idempotencyKey, requestFingerprint, createdAt: now, updatedAt: now } });
}
