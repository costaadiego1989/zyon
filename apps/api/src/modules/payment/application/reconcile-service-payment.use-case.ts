import { BadRequestException, ConflictException, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { CompletedOrder, PaymentIntent, Prisma, PrismaClient, ServiceAppointment } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import { fulfillmentPaymentEligible } from "../../../shared/persistence/order-fulfillment.js";
import { professionalOrderLine, reserveProfessionalOrderUnit } from "../../../shared/bookings/service-order-appointment.js";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { currentWhatsAppExecution, withoutWhatsAppExecutionForVerifiedOperation } from "../../../shared/whatsapp/whatsapp-automation-context.js";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value && value.length <= 191;
type UnitResult = { unitId: string | null; status: "reconciled" | "regularization"; bookingConfirmed: boolean; appointmentId?: string; reason?: string };
type Claim = { eventId: string; merchantId: string; intentId: string; sessionId: string; correlationId: string; token: string };

export function regularizationIdentity(merchantId: string, paymentIntentId: string, orderId: string, unitReference: string): string {
  return createHash("sha256").update(JSON.stringify(["service-payment-regularization-v1", merchantId, paymentIntentId, orderId, unitReference])).digest("hex");
}
export function servicePaymentBookingConfirmed(appointment: { operationalStatus: string } | null): boolean {
  return !!appointment && ["scheduled", "in_service", "completed", "no_show"].includes(appointment.operationalStatus);
}
function claim(event: DomainEvent): Claim {
  const token = Object.getOwnPropertyDescriptor(event, "deliveryLeaseToken"), payload = event.payload;
  if (event.eventType !== "payment.status.changed" || event.schemaVersion !== 1 || !id(event.eventId) || !id(event.merchantId)
    || !id(event.correlationId) || !object(payload) || payload.status !== "approved" || !id(payload.payment_intent_id)
    || !id(payload.session_id) || event.causationId !== payload.payment_intent_id || !token || token.enumerable || !id(token.value))
    throw new Error("service_payment_claim_required");
  return { eventId: event.eventId, merchantId: event.merchantId, intentId: payload.payment_intent_id,
    sessionId: payload.session_id, correlationId: event.correlationId, token: token.value };
}

/** Financial approval and capacity are separate facts. Only T26/T35 can create
 * an appointment; this command never dispatches, refunds or reallocates money. */
@Injectable()
export class ReconcileServicePaymentUseCase implements OnModuleInit {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    private readonly tenant: TenantContextService) {}

  onModuleInit(): void {
    this.events.subscribe("payment.status.changed", event => this.handle(event), "service-payment.reconcile.v1");
  }
  async handle(event: DomainEvent): Promise<void> {
    if (!object(event.payload) || event.payload.status !== "approved") return;
    const proof = claim(event); this.assertScope(proof.merchantId);
    await this.tenant.run({ merchantId: proof.merchantId, userId: "service-payment-reconciliation", role: "system" }, () =>
      this.prisma.$transaction(async tx => {
        await lockCatalogMerchant(tx, proof.merchantId);
        await this.assertClaim(tx, proof);
        await withoutWhatsAppExecutionForVerifiedOperation(() => this.within(tx, proof.merchantId, proof.intentId, proof));
        // Serialize final ownership with renewal/reclaim through COMMIT.
        // Admission IO above leaves the heartbeat free to renew its claim.
        await tx.$queryRaw`SELECT event_id FROM outbox_messages
          WHERE event_id = ${proof.eventId} AND merchant_id = ${proof.merchantId} FOR UPDATE`;
        await this.assertClaim(tx, proof);
      }));
  }
  /** Internal server command, not a webhook DTO or a model tool. */
  async execute(merchantId: string, paymentIntentId: string): Promise<{ status: "processed" | "not_approved"; units: UnitResult[] }> {
    if (!id(merchantId) || !id(paymentIntentId)) throw new BadRequestException("service_payment_reference_invalid");
    if (currentWhatsAppExecution()) throw new ConflictException("service_payment_verified_dispatch_required");
    this.assertScope(merchantId);
    return this.tenant.run({ merchantId, userId: "service-payment-reconciliation", role: "system" }, () =>
      this.prisma.$transaction(async tx => { await lockCatalogMerchant(tx, merchantId); return this.within(tx, merchantId, paymentIntentId); }));
  }
  private assertScope(merchantId: string): void {
    const current = this.tenant.get();
    if (current && current.merchantId !== merchantId) throw new Error("service_payment_scope_mismatch");
  }
  private async assertClaim(tx: Prisma.TransactionClient, proof: Claim): Promise<void> {
    const row = await tx.outboxMessage.findFirst({ where: { eventId: proof.eventId, merchantId: proof.merchantId } });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const payload = row?.payload;
    if (!row || row.eventId !== proof.eventId || row.merchantId !== proof.merchantId || row.eventType !== "payment.status.changed"
      || row.schemaVersion !== 1 || row.producer !== "checkout" || row.status !== "processing" || row.leaseToken !== proof.token
      || row.correlationId !== proof.correlationId || row.causationId !== proof.intentId || !object(payload)
      || payload.payment_intent_id !== proof.intentId || payload.session_id !== proof.sessionId || payload.status !== "approved"
      || !(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime()) || !(row.leaseExpiresAt instanceof Date) || row.leaseExpiresAt <= clock.now)
      throw new Error("service_payment_lease_lost");
  }
  private async within(tx: Prisma.TransactionClient, merchantId: string, paymentIntentId: string, proof?: Claim)
    : Promise<{ status: "processed" | "not_approved"; units: UnitResult[] }> {
    await tx.$queryRaw`SELECT id FROM payment_intents WHERE id = ${paymentIntentId} AND merchant_id = ${merchantId} FOR UPDATE`;
    const payment = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId } });
    if (!payment) throw new ConflictException("service_payment_intent_not_found");
    if (proof && payment.sessionId !== proof.sessionId) throw new Error("service_payment_lease_lost");
    if (payment.status !== "approved") return { status: "not_approved", units: [] };
    const order = await tx.completedOrder.findFirst({ where: { merchantId, sessionId: payment.sessionId, externalOrderId: payment.providerPaymentId ?? "" } });
    // The original completion handler may still be in flight. Let the same
    // durable payment event retry; do not acknowledge a missing financial link.
    if (!order) throw new ConflictException("service_payment_completion_pending");
    if (!fulfillmentPaymentEligible(order, payment)) throw new ConflictException("fulfillment_payment_required");
    const units: UnitResult[] = [], lines = Array.isArray(order.lineItemsJson) ? order.lineItemsJson : [];
    for (const [index, raw] of lines.entries()) {
      if (!object(raw) || raw.productType !== "service" || raw.fulfillmentStrategy !== "scheduled_service") continue;
      const unitId = id(raw.lineId) ? raw.lineId : null, reference = unitId ?? "snapshot-index:" + index;
      const receiptId = "service-payment-regularization:" + regularizationIdentity(merchantId, payment.id, order.id, reference);
      const prior = await tx.merchantNotification.findUnique({ where: { id: receiptId } });
      if (prior) {
        const data = prior.metadata;
        if (prior.merchantId !== merchantId || prior.type !== "service_payment_regularization" || !object(data)
          || data.paymentIntentId !== payment.id || data.orderId !== order.id || data.unitId !== unitId || typeof data.bookingConfirmed !== "boolean")
          throw new ConflictException("service_payment_regularization_identity_conflict");
        // The receipt describes the original financial incident. The command
        // result describes today's canonical booking, without mutating history.
        const bound = unitId ? await tx.serviceAppointment.findFirst({ where: { merchantId, orderId: order.id, orderUnitId: unitId } }) : null;
        const current = bound ?? (id(data.appointmentId)
          ? await tx.serviceAppointment.findFirst({ where: { id: data.appointmentId, merchantId } }) : null);
        units.push({ unitId, status: "regularization", bookingConfirmed: servicePaymentBookingConfirmed(current),
          ...(current ? { appointmentId: current.id } : {}), ...(typeof data.reason === "string" ? { reason: data.reason } : {}) });
        continue;
      }
      let appointment: ServiceAppointment | null = null, reason: string | undefined;
      try {
        if (!unitId || !professionalOrderLine(order, unitId)) throw new ConflictException("service_legacy_classification_required");
        if (order.status !== "approved") throw new ConflictException("service_order_state_review");
        appointment = (await reserveProfessionalOrderUnit(tx, merchantId, order.id, unitId)).appointment;
        if (!servicePaymentBookingConfirmed(appointment)) reason = "service_appointment_state_review";
      } catch (error) {
        // reserveProfessionalOrderUnit rolls its savepoint back before domain
        // refusals arrive here. SQL/Redis outages remain retryable errors.
        if (!(error instanceof ConflictException) && !(error instanceof BadRequestException)) throw error;
        reason = /^[a-z0-9_]{1,96}$/.test(error.message) ? error.message : "service_admission_unavailable";
      }
      if (!reason) {
        units.push({ unitId, status: "reconciled", bookingConfirmed: true, appointmentId: appointment!.id }); continue;
      }
      const linked = unitId ? await this.linkedManual(tx, order, payment, unitId) : null;
      appointment ??= linked;
      if (appointment) {
        // This is an unresolved obligation, not a new allocated payment receipt.
        // Keep its original amount/status/identity and the separate PSP fact.
        await tx.appointmentPayment.updateMany({ where: { merchantId, appointmentId: appointment.id,
          paymentIntentId: payment.id, mode: "online", requiresRegularization: false }, data: { requiresRegularization: true, regularizationReason: reason, version: { increment: 1 } } });
      }
      const bookingConfirmed = servicePaymentBookingConfirmed(appointment), now = new Date();
      const metadata = { schemaVersion: 1, paymentIntentId: payment.id, orderId: order.id, unitId, sourceLineIndex: index,
        reason, paymentStatus: "approved", approvedAmountCents: payment.approvedAmountCents, currency: payment.currency,
        providerPaymentId: payment.providerPaymentId, bookingConfirmed,
        ...(appointment ? { appointmentId: appointment.id, appointmentVersion: appointment.version, operationalStatus: appointment.operationalStatus } : {}) };
      await tx.merchantNotification.create({ data: { id: receiptId, merchantId, type: "service_payment_regularization",
        title: "Pagamento de atendimento requer regularização",
        body: bookingConfirmed ? "O pagamento foi aprovado e o atendimento foi confirmado. A empresa precisa revisar a pendência indicada."
          : "O pagamento foi aprovado. Este atendimento precisa de regularização pela empresa; nenhuma nova vaga ou cobrança foi confirmada.", metadata } });
      await tx.outboxMessage.create({ data: { eventId: receiptId, eventType: "service.payment.regularization_required", schemaVersion: 1,
        merchantId, producer: "service-booking", occurredAt: now, correlationId: order.id, causationId: payment.id, payload: metadata } });
      units.push({ unitId, status: "regularization", bookingConfirmed, reason, ...(appointment ? { appointmentId: appointment.id } : {}) });
    }
    return { status: "processed", units };
  }
  private async linkedManual(tx: Prisma.TransactionClient, order: CompletedOrder, payment: PaymentIntent, unitId: string): Promise<ServiceAppointment | null> {
    const rows = await tx.appointmentAudit.findMany({ where: { merchantId: order.merchantId, action: "manual_payment_prepare", AND: [
      { after: { path: ["privatePaymentContinuation", "paymentIntentId"], equals: payment.id } },
      { after: { path: ["privatePaymentContinuation", "unitId"], equals: unitId } } ] }, take: 2 });
    if (!rows.length) return null;
    if (rows.length !== 1) throw new ConflictException("service_payment_correlation_invalid");
    const row = rows[0], p = object(row.after) ? row.after.privatePaymentContinuation : undefined;
    if (!object(p) || p.schemaVersion !== 1 || p.merchantId !== order.merchantId || p.sessionId !== order.sessionId
      || p.paymentIntentId !== payment.id || p.unitId !== unitId || p.appointmentId !== row.appointmentId
      || p.operatorId !== row.actorId || p.appointmentVersion !== row.version || !id(p.paymentRecordId) || !object(p.selection))
      throw new ConflictException("service_payment_correlation_invalid");
    const appointment = await tx.serviceAppointment.findFirst({ where: { id: row.appointmentId, merchantId: order.merchantId, origin: "manual" } });
    const balance = await tx.appointmentPayment.findFirst({ where: { id: p.paymentRecordId, merchantId: order.merchantId,
      appointmentId: row.appointmentId, paymentIntentId: payment.id, mode: "online" } });
    if (!appointment || appointment.requestFingerprint !== p.admissionFingerprint || !balance || balance.requestFingerprint !== p.requestFingerprint
      || balance.amountCents !== p.selection.priceInCents || balance.currency !== p.selection.currency)
      throw new ConflictException("service_payment_correlation_invalid");
    return appointment;
  }
}
