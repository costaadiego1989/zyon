import React from "react";
import type { ComponentType } from "react";
import type { ServiceAppointmentOperationSummary } from "@zyon/shared-types";
import { manualFixture, manualDetail, type ManualTestProps, type ManualTestRequest } from "./manual-appointment.test-fixture.js";
import type { AppointmentDetailProps } from "./useAppointmentDetail.js";

export const operationHash = "a".repeat(64), acceptedHash = "b".repeat(64);
export const operationPolicies = () => ({ hash: operationHash, references: [{ sourceId: "cancellation", sourceVersion: "policy-v1", sourceHash: operationHash, publicationState: "published" }],
  policies: [{ sourceId: "cancellation", sourceVersion: "policy-v1", sourceHash: operationHash, publicationState: "published", text: "Política canônica de cancelamento: atendimento por solicitação explícita. Reembolso exige análise separada." }] });
export function operationSummary(version = 1): ServiceAppointmentOperationSummary { return { merchantId: "merchant-a", appointmentId: "appointment-a", appointmentVersion: version, asOf: "2030-01-01T12:00:00Z", attendanceActions: ["start_service", "no_show"], canReviewCancellation: true, canReviewRescheduling: true,
  localPayments: [{ paymentId: "balance-a", paymentVersion: 2, currency: "BRL", balanceStatus: "available", receivedCents: 1000, remainingCents: 4000, canRecordReceipt: true }] }; }

/** Real React/SDK gestures, synthetic HTTP responses only. No SQL/auth/provider proof. */
export async function detailFixture(Component: ComponentType<AppointmentDetailProps>, options: { handle?: (request: ManualTestRequest) => Response | Promise<Response> | undefined; financialReview?: boolean } = {}) {
  let selected = "appointment-a";
  let detail: any = { ...manualDetail("at_attendance"), origin: "whatsapp", history: [{ id: "audit-original", action: "create", actorId: null, origin: "whatsapp", version: 1, occurredAt: "2030-01-01T12:00:00Z" }], payments: [{ ...manualDetail("at_attendance").payments[0], version: 2 }] };
  let summary: any = operationSummary();
  function Probe(props: ManualTestProps) { return <Component {...props} appointmentId={selected} />; }
  const f = await manualFixture(Probe, { mode: "at_attendance", handle: request => {
    const custom = options.handle?.(request); if (custom !== undefined) return custom;
    if (request.path.endsWith("/operation-summary")) return Response.json({ ...summary, appointmentId: selected });
    if (request.path.endsWith("/operation-policy")) return Response.json(operationPolicies());
    if (request.method === "GET" && /\/service-appointments\/appointment-[ab]$/.test(request.path)) return Response.json({ ...detail, id: request.path.split("/").at(-1) });
    if (request.path.endsWith("/service-availability/dates")) return Response.json({ status: "ready", professionalVersion: 7, policyVersion: 3, timeZone: "America/Sao_Paulo", durationMinutes: 30, asOf: "2030-01-01T12:00:00Z", dates: ["2030-01-03"] });
    if (request.path.endsWith("/service-availability/slots")) return Response.json({ status: "ready", professionalVersion: 7, policyVersion: 3, timeZone: "America/Sao_Paulo", durationMinutes: 30, asOf: "2030-01-01T12:00:00Z", dates: ["2030-01-03"], slots: [{ date: "2030-01-03", startTime: "11:00", startsAt: "2030-01-03T14:00:00.000Z", endsAt: "2030-01-03T14:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30 }] });
    if (request.path.endsWith("/reschedule-quote")) return Response.json({ quote: { merchantId: "merchant-a", appointmentId: selected, version: detail.version, productId: detail.productId, variantId: detail.variantId, professionalId: request.body.destination.professionalId, professionalVersion: request.body.destination.expectedProfessionalVersion,
      policyVersion: 3, policyHash: operationHash, startsAt: request.body.destination.startsAt, endsAt: "2030-01-03T14:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30, priceInCents: 5000, currency: "BRL", paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null }, quoteHash: acceptedHash, requiresSeparateFinancialReview: options.financialReview === true });
    if (request.path.endsWith("/attendance-receipts")) {
      const body = request.body; detail = { ...detail, payments: [{ ...detail.payments[0], status: "approved", receivedAt: "2030-01-01T12:05:00Z", version: 3 }] };
      summary = { ...summary, localPayments: [{ ...summary.localPayments[0], paymentVersion: 3, receivedCents: 5000, remainingCents: 0, balanceStatus: "not_payable", canRecordReceipt: false }] };
      return Response.json({ source: "recorded_at_attendance", replayed: false, receipt: { id: "receipt-a", appointmentPaymentId: body.paymentId, amountCents: body.amountCents, currency: body.currency, paymentMethod: body.paymentMethod, operatorId: "owner-a", receivedAt: "2030-01-01T12:05:00Z" }, payment: { ...detail.payments[0], appointmentId: selected } }, { status: 201 });
    }
    if (request.path.endsWith("/transitions") || request.path.endsWith("/cancel") || request.path.endsWith("/reschedule")) {
      const body = request.body, state = request.path.endsWith("/cancel") ? "cancelled" : body.action === "start_service" ? "in_service" : body.action === "complete_service" ? "completed" : body.action === "no_show" ? "no_show" : detail.operationalStatus;
      detail = { ...detail, version: detail.version + 1, operationalStatus: state, ...(body.destination ? { professionalId: body.destination.professionalId, startsAt: body.destination.startsAt, endsAt: "2030-01-03T14:30:00.000Z" } : {}) };
      summary = { ...summary, appointmentVersion: detail.version, attendanceActions: state === "in_service" ? ["complete_service"] : [], canReviewCancellation: state === "in_service", canReviewRescheduling: state === "scheduled" };
      return Response.json({ appointment: detail, replayed: false, appliedVersion: body.expectedVersion + 1 }, { status: 201 });
    }
    return undefined;
  } });
  return { ...f, commands: () => f.requests.filter(row => row.method === "POST" && /\/(transitions|cancel|reschedule|attendance-receipts)$/.test(row.path)),
    select: async (id: string) => { selected = id; await f.render(); } };
}
