import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { AppointmentPayment, AttendanceReceipt, Prisma, PrismaClient } from "@prisma/client";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { admitWhatsAppEffectInTransaction } from "../../../shared/whatsapp/whatsapp-automation-context.js";
import { assertExpectedVersion } from "../../catalog/domain/services/service-professional-input.js";

export interface AttendanceReceiptCommand {
  appointmentId: string;
  paymentId: string;
  expectedPaymentVersion: number;
  amountCents: number;
  currency: string;
  paymentMethod: string;
  commandId: string;
}
interface ReceiptContext { /** Internal server/test seam, never a body timestamp. */ clock?: () => Date }
type ReceiptView = Pick<AttendanceReceipt, "id" | "appointmentPaymentId" | "amountCents" | "currency" | "paymentMethod" | "operatorId" | "receivedAt">;
type PaymentView = Pick<AppointmentPayment, "id" | "appointmentId" | "mode" | "status" | "amountCents" | "currency" | "receivedAt" | "version">;
export interface AttendanceReceiptResult {
  source: "recorded_at_attendance";
  replayed: boolean;
  receipt: ReceiptView;
  payment: PaymentView;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown) => typeof value === "string" && value.trim() === value && !!value && value.length <= 191;
const cents = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const currency = (value: unknown) => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function capture(input: AttendanceReceiptCommand): AttendanceReceiptCommand {
  if (!object(input) || Object.keys(input).some(key => !["appointmentId", "paymentId", "expectedPaymentVersion", "amountCents", "currency", "paymentMethod", "commandId"].includes(key))
    || !id(input.appointmentId) || !id(input.paymentId) || !id(input.commandId) || !cents(input.amountCents) || !currency(input.currency)
    || typeof input.paymentMethod !== "string" || !input.paymentMethod.trim() || input.paymentMethod.length > 64 || /[\x00-\x1f\x7f]/.test(input.paymentMethod))
    throw new BadRequestException("service_receipt_command_invalid");
  assertExpectedVersion(input.expectedPaymentVersion);
  return Object.freeze({ ...input, paymentMethod: input.paymentMethod.trim() });
}

function result(receipt: AttendanceReceipt, payment: AppointmentPayment, replayed: boolean): AttendanceReceiptResult {
  return { source: "recorded_at_attendance", replayed,
    receipt: { id: receipt.id, appointmentPaymentId: receipt.appointmentPaymentId, amountCents: receipt.amountCents, currency: receipt.currency,
      paymentMethod: receipt.paymentMethod, operatorId: receipt.operatorId, receivedAt: receipt.receivedAt },
    payment: { id: payment.id, appointmentId: payment.appointmentId, mode: payment.mode, status: payment.status,
      amountCents: payment.amountCents, currency: payment.currency, receivedAt: payment.receivedAt, version: payment.version } };
}

/** Records a human's local financial fact, independently of attendance. The
 * caller must roll back on rejection; the class entrypoint owns the transaction. */
export async function recordAttendanceReceiptWithin(tx: Prisma.TransactionClient, actor: ServiceActor,
  input: AttendanceReceiptCommand, context: ReceiptContext = {}): Promise<AttendanceReceiptResult> {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === "function")
    throw new BadRequestException("service_receipt_transaction_required");
  input = capture(input);
  actor = Object.freeze({ ...actor });
  await admitWhatsAppEffectInTransaction(tx, actor.merchantId);
  await lockCatalogMerchant(tx, actor.merchantId);
  await assertServiceAdministration(tx, actor);
  const selected = await tx.serviceAppointment.findFirst({ where: { id: input.appointmentId, merchantId: actor.merchantId },
    select: { professionalId: true } });
  if (!selected) throw new NotFoundException("service_appointment_not_found");
  await lockServiceProfessional(tx, actor.merchantId, selected.professionalId);
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM service_appointments
    WHERE id = ${input.appointmentId} AND merchant_id = ${actor.merchantId} FOR UPDATE`;
  if (locked.length !== 1) throw new NotFoundException("service_appointment_not_found");
  const appointment = await tx.serviceAppointment.findFirst({ where: { id: input.appointmentId, merchantId: actor.merchantId } });
  if (!appointment || appointment.professionalId !== selected.professionalId) throw new ConflictException("service_appointment_version_conflict");
  const paymentLock = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM appointment_payments
    WHERE id = ${input.paymentId} AND merchant_id = ${actor.merchantId} AND appointment_id = ${appointment.id} FOR UPDATE`;
  if (paymentLock.length !== 1) throw new NotFoundException("service_payment_not_found");
  const scope = { id: input.paymentId, merchantId: actor.merchantId, appointmentId: appointment.id };
  const payment = await tx.appointmentPayment.findFirst({ where: scope });
  if (!payment) throw new NotFoundException("service_payment_not_found");
  const fingerprint = hash(["attendance-receipt-v1", actor.merchantId, actor.userId, input.appointmentId, input.paymentId,
    input.expectedPaymentVersion, input.amountCents, input.currency, input.paymentMethod]);
  const receipt = await tx.attendanceReceipt.findUnique({ where: { merchantId_idempotencyKey: {
    merchantId: actor.merchantId, idempotencyKey: input.commandId } } });
  const prior = await tx.appointmentAudit.findUnique({ where: { merchantId_commandId: {
    merchantId: actor.merchantId, commandId: input.commandId } } });
  if (receipt || prior) {
    const after = prior?.after;
    if (!receipt || !prior || receipt.appointmentPaymentId !== payment.id || receipt.operatorId !== actor.userId
      || receipt.requestFingerprint !== fingerprint || receipt.amountCents !== input.amountCents || receipt.currency !== input.currency
      || receipt.paymentMethod !== input.paymentMethod || prior.appointmentId !== appointment.id || prior.actorId !== actor.userId
      || prior.action !== "attendance_receipt" || prior.origin !== "operator" || prior.version > appointment.version
      || !object(after) || after.requestFingerprint !== fingerprint || after.receiptId !== receipt.id || after.paymentId !== payment.id
      || after.paymentVersion !== input.expectedPaymentVersion + 1 || after.source !== "recorded_at_attendance"
      || payment.version < input.expectedPaymentVersion + 1)
      throw new ConflictException("service_receipt_idempotency_conflict");
    // The immutable receipt is historical. Later financial/attendance facts are
    // returned as they are, never restored to this command's previous state.
    return result(receipt, payment, true);
  }
  if (payment.mode !== "at_attendance" || payment.paymentIntentId !== null || payment.provider !== null
    || payment.providerPaymentId !== null || payment.providerEvidence !== null)
    throw new ConflictException("service_local_payment_required");
  if (payment.version !== input.expectedPaymentVersion) throw new ConflictException("service_financial_version_conflict");
  if (payment.status !== "pending" || payment.receivedAt !== null) throw new ConflictException("service_local_payment_already_settled");
  if (!cents(payment.amountCents) || !currency(payment.currency)) throw new ConflictException("service_receipt_balance_invalid");
  const receiptScope = { merchantId: actor.merchantId, appointmentPaymentId: payment.id };
  const invalid = await tx.attendanceReceipt.findFirst({ where: { ...receiptScope,
    OR: [{ currency: { not: payment.currency } }, { amountCents: { lte: 0 } }] }, select: { id: true } });
  const historical = await tx.attendanceReceipt.aggregate({ where: receiptScope, _sum: { amountCents: true } });
  const received = historical._sum.amountCents ?? 0;
  if (invalid || !Number.isSafeInteger(received) || received < 0 || received >= payment.amountCents)
    throw new ConflictException("service_receipt_balance_invalid");
  if (input.currency !== payment.currency) throw new ConflictException("service_receipt_currency_mismatch");
  if (input.amountCents !== payment.amountCents - received) throw new ConflictException("service_receipt_amount_mismatch");
  // The current financial balance can reflect an accepted rescheduling price.
  // Its immutable creation fingerprint and today's catalog price are not price authorities.
  const instant = context.clock ? context.clock() : (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0]?.now;
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new BadRequestException("service_receipt_clock_invalid");
  const now = new Date(instant.getTime()), paymentVersion = input.expectedPaymentVersion + 1;
  const recorded = await tx.attendanceReceipt.create({ data: { id: randomUUID(), merchantId: actor.merchantId,
    appointmentPaymentId: payment.id, amountCents: input.amountCents, currency: input.currency, paymentMethod: input.paymentMethod,
    operatorId: actor.userId, receivedAt: now, createdAt: now, idempotencyKey: input.commandId, requestFingerprint: fingerprint } });
  const changed = await tx.appointmentPayment.updateMany({ where: { ...scope, mode: "at_attendance", status: "pending",
    receivedAt: null, version: input.expectedPaymentVersion }, data: { status: "approved", receivedAt: now, version: { increment: 1 }, updatedAt: now } });
  if (changed.count !== 1) throw new ConflictException("service_financial_version_conflict");
  await tx.appointmentAudit.create({ data: { merchantId: actor.merchantId, appointmentId: appointment.id, commandId: input.commandId,
    version: appointment.version, action: "attendance_receipt", actorId: actor.userId, origin: "operator", occurredAt: now,
    before: { paymentId: payment.id, paymentVersion: payment.version, status: payment.status, amountCents: payment.amountCents,
      currency: payment.currency, historicalReceivedCents: received },
    after: { receiptId: recorded.id, paymentId: payment.id, paymentVersion, status: "approved", amountCents: input.amountCents,
      currency: input.currency, paymentMethod: input.paymentMethod, operatorId: actor.userId, receivedAt: now.toISOString(),
      source: "recorded_at_attendance", requestFingerprint: fingerprint } } });
  const eventType = "service.payment.recorded_at_attendance";
  await tx.outboxMessage.create({ data: { eventId: hash([actor.merchantId, payment.id, paymentVersion, eventType]), eventType,
    schemaVersion: 1, merchantId: actor.merchantId, occurredAt: now, correlationId: appointment.id, causationId: input.commandId,
    producer: "service-booking", payload: { appointmentId: appointment.id, appointmentVersion: appointment.version,
      paymentId: payment.id, paymentVersion, receiptId: recorded.id } } });
  const current = await tx.appointmentPayment.findFirst({ where: scope });
  if (!current || current.version !== paymentVersion || current.status !== "approved" || current.receivedAt?.getTime() !== now.getTime())
    throw new ConflictException("service_financial_version_conflict");
  return result(recorded, current, false);
}

export class RecordAttendanceReceiptUseCase {
  constructor(private readonly prisma: PrismaClient) {}
  async execute(actor: ServiceActor, input: AttendanceReceiptCommand, context: ReceiptContext = {}) {
    const original = capture(input), principal = Object.freeze({ ...actor });
    return this.prisma.$transaction(tx => recordAttendanceReceiptWithin(tx, principal, original, context));
  }
}
