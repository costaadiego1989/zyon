import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { ServiceAppointmentOperationSummary } from "@zyon/shared-types";
import { assertServiceAdministration, type ServiceActor } from "../../../shared/bookings/service-business-access.js";
import { attendanceTarget, type AttendanceAction } from "./transition-service-appointment.use-case.js";

const positiveCents = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2_147_483_647;
/** Read-only review data. A displayed action or balance is never a write grant. */
export class ReadServiceAppointmentOperationSummary {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(actor: ServiceActor, appointmentId: string): Promise<ServiceAppointmentOperationSummary> {
    actor = { ...actor };
    if (typeof appointmentId !== "string" || !appointmentId || appointmentId.trim() !== appointmentId
      || appointmentId.length > 191 || /[\x00-\x1f\x7f]/.test(appointmentId)) throw new BadRequestException("appointment_id_invalid");
    return this.prisma.$transaction(async tx => {
      await assertServiceAdministration(tx, actor);
      const [clock] = await tx.$queryRaw<Array<{ asOf: Date }>>`SELECT transaction_timestamp() AS "asOf"`;
      if (!(clock?.asOf instanceof Date) || !Number.isFinite(clock.asOf.getTime())) throw new ServiceUnavailableException("appointment_read_clock_unavailable");
      const appointment = await tx.serviceAppointment.findFirst({ where: { merchantId: actor.merchantId, id: appointmentId },
        select: { id: true, version: true, operationalStatus: true } });
      if (!appointment) throw new NotFoundException("service_appointment_not_found");
      const payments = await tx.appointmentPayment.findMany({ where: { merchantId: actor.merchantId, appointmentId },
        select: { id: true, version: true, mode: true, status: true, amountCents: true, currency: true, receivedAt: true,
          paymentIntentId: true, provider: true, providerPaymentId: true, providerEvidence: true }, orderBy: { id: "asc" }, take: 101 });
      if (payments.length > 100) throw new ServiceUnavailableException("appointment_financial_source_limit");
      const local = payments.filter(payment => payment.mode === "at_attendance");
      const groups = local.length ? await tx.attendanceReceipt.groupBy({ by: ["appointmentPaymentId", "currency"],
        where: { merchantId: actor.merchantId, appointmentPaymentId: { in: local.map(payment => payment.id) } },
        _sum: { amountCents: true }, _min: { amountCents: true },
        orderBy: [{ appointmentPaymentId: "asc" }, { currency: "asc" }], take: 101 }) : [];
      if (groups.length > 100 || groups.some(group => !local.some(payment => payment.id === group.appointmentPaymentId)))
        throw new ServiceUnavailableException("appointment_receipt_source_limit");
      const actions: AttendanceAction[] = [];
      for (const action of ["start_service", "complete_service", "no_show"] as const) {
        try { attendanceTarget(appointment.operationalStatus, action); actions.push(action); }
        catch (error) { if (!(error instanceof ConflictException)) throw error; }
      }
      const localPayments: ServiceAppointmentOperationSummary["localPayments"] = local.map(payment => {
        const unavailable = { paymentId: payment.id, paymentVersion: payment.version, currency: payment.currency,
          balanceStatus: "unavailable" as const, receivedCents: null, remainingCents: null, canRecordReceipt: false };
        if (!positiveCents(payment.amountCents) || !/^[A-Z]{3}$/.test(payment.currency) || payment.paymentIntentId !== null
          || payment.provider !== null || payment.providerPaymentId !== null || payment.providerEvidence !== null) return unavailable;
        const receipts = groups.filter(group => group.appointmentPaymentId === payment.id);
        if (receipts.some(group => group.currency !== payment.currency || !positiveCents(group._min.amountCents)
          || !Number.isSafeInteger(group._sum.amountCents) || (group._sum.amountCents ?? 0) <= 0)) return unavailable;
        const received = receipts.reduce((sum, group) => sum + (group._sum.amountCents ?? 0), 0);
        if (!Number.isSafeInteger(received) || received > payment.amountCents) return unavailable;
        const remaining = payment.amountCents - received;
        if (payment.status === "pending" && payment.receivedAt === null && remaining > 0)
          return { ...unavailable, balanceStatus: "available", receivedCents: received, remainingCents: remaining, canRecordReceipt: true };
        if (payment.status === "approved" && payment.receivedAt !== null && remaining === 0)
          return { ...unavailable, balanceStatus: "not_payable", receivedCents: received, remainingCents: 0 };
        return unavailable;
      });
      return { merchantId: actor.merchantId, appointmentId: appointment.id, appointmentVersion: appointment.version,
        asOf: clock.asOf.toISOString(), attendanceActions: actions,
        canReviewCancellation: ["pending", "scheduled", "in_service"].includes(appointment.operationalStatus),
        canReviewRescheduling: ["pending", "scheduled"].includes(appointment.operationalStatus), localPayments };
    }, { isolationLevel: "RepeatableRead" });
  }
}
