import { createHash, randomUUID } from "node:crypto";
import { Injectable, Inject, Optional, type OnModuleInit } from "@nestjs/common";
import type { Prisma, PrismaClient, PostSaleMessageTemplate, WhatsAppWebhookInbox } from "@prisma/client";
import type { DomainEvent, DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { canonicalJson } from "../../../shared/http/canonical-json.js";
import { lockCatalogMerchant } from "../../../shared/persistence/catalog-stock-ledger.js";
import { lockServiceProfessional } from "../../../shared/bookings/service-professional-lock.js";
import { fulfillmentPaymentEligible } from "../../../shared/persistence/order-fulfillment.js";
import { professionalOrderLine } from "../../../shared/bookings/service-order-appointment.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { currentWhatsAppSubmissionScope, withWhatsAppSubmission, withoutWhatsAppExecutionForVerifiedOperation,
  type WhatsAppRequestScope } from "../../../shared/whatsapp/whatsapp-automation-context.js";
import { connectedMetaCloudCredentials } from "../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js";
import { operatorConnection, type OperatorRequestScope } from "../../whatsapp-channel/domain/services/whatsapp-operator-connection.js";
import { normalizeRecoveryRecipient } from "../../whatsapp-templates/domain/services/recovery-whatsapp-policy.js";
import { decodeWhatsAppCredentials } from "../../whatsapp-channel/infrastructure/repositories/whatsapp-credential-codec.js";
import type { WhatsAppChannelConfigEntity } from "../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { DOMAIN_EVENT_BUS } from "../../../shared/events/domain-event-bus.port.js";
import { NOTIFICATION_WHATSAPP_SENDER } from "./ports/notification-whatsapp-sender.port.js";
import { currentServiceNoticeTransport } from "./ports/notification-whatsapp-sender.port.js";
import { formatServiceAppointmentConfirmation } from "../../whatsapp-channel/domain/ui/service-appointment-confirmation.js";
import { checkoutTone } from "../../checkout/domain/services/checkout-collection-copy.js";
import { findMerchantAgentRule } from "../../agent-rules/infrastructure/find-merchant-agent-rule.js";
import type { NotificationWhatsAppSender, NotificationWhatsAppResult, ServiceNotificationInput } from "./ports/notification-whatsapp-sender.port.js";

const SCHEDULED = "service.appointment.scheduled", RECEIPT = "service.payment.recorded_at_attendance";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.trim() === v && v.length <= 191;
const version = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const hash = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");
interface Proof { eventId: string; eventType: string; merchantId: string; correlationId: string; causationId: string; token: string;
  payload: Record<string, unknown>; appointmentId: string; appointmentVersion: number; paymentId?: string; paymentVersion?: number; receiptId?: string }
export interface ServiceNoticeFacts { appointmentId: string; appointmentVersion: number; recipient: string; text: string }
export type ServiceNoticePresentation = (facts: Readonly<ServiceNoticeFacts>) => { text: string; mediaUrl?: string };
interface Facts extends ServiceNoticeFacts { config: WhatsAppChannelConfigEntity; identity: string }
interface Attempt { proof: Proof; id: string; token: string; scope: OperatorRequestScope; factsIdentity: string; input: ServiceNotificationInput; metadata: Record<string, unknown> }
interface Tracker { invoked: boolean; denied?: string; commitUnknown: boolean }
class NotStarted extends Error {}

function claim(event: DomainEvent): Proof {
  const token = Object.getOwnPropertyDescriptor(event, "deliveryLeaseToken"), p = event.payload;
  if (![SCHEDULED, RECEIPT].includes(event.eventType) || event.schemaVersion !== 1 || !id(event.eventId) || !id(event.merchantId)
    || !id(event.correlationId) || !id(event.causationId) || !token || token.enumerable || !id(token.value) || !object(p) || !id(p.appointmentId)
    || p.appointmentId !== event.correlationId) throw new Error("service_notice_claim_required");
  if (event.eventType === SCHEDULED ? !version(p.version) || p.operationalStatus !== "scheduled"
    || Object.keys(p).some(k => !["appointmentId", "version", "operationalStatus"].includes(k))
    : !version(p.appointmentVersion) || !version(p.paymentVersion) || !id(p.paymentId) || !id(p.receiptId)
      || Object.keys(p).some(k => !["appointmentId", "appointmentVersion", "paymentId", "paymentVersion", "receiptId"].includes(k))) throw new Error("service_notice_claim_required");
  return Object.freeze({ eventId: event.eventId, eventType: event.eventType, merchantId: event.merchantId,
    correlationId: event.correlationId, causationId: event.causationId, token: token.value, payload: Object.freeze({ ...p }),
    appointmentId: p.appointmentId, appointmentVersion: Number(event.eventType === SCHEDULED ? p.version : p.appointmentVersion),
    ...(event.eventType === RECEIPT ? { paymentId: String(p.paymentId), paymentVersion: Number(p.paymentVersion), receiptId: String(p.receiptId) } : {}) });
}
const inline = (v: unknown) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f*_~`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "";

/** Durable service event consumer. Existing booking/financial writers retain all
 * authority; this class writes only its WhatsAppDelivery notification claim. */
@Injectable()
export class ServiceAppointmentEventsConsumer implements OnModuleInit {
  private registered = false;
  private readonly active = new Map<string, Promise<void>>();
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(NOTIFICATION_WHATSAPP_SENDER) private readonly sender: NotificationWhatsAppSender,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus, private readonly tenant: TenantContextService,
    @Optional() private readonly presentation?: ServiceNoticePresentation) {}
  onModuleInit(): void {
    if (this.registered) return;
    this.registered = true;
    for (const type of [SCHEDULED, RECEIPT]) this.events.subscribe(type, event => this.handle(event), "service-appointment.notice.v1");
  }
  async handle(event: DomainEvent): Promise<void> {
    const proof = claim(event), context = this.tenant.get();
    if (context && context.merchantId !== proof.merchantId) throw new Error("service_notice_scope_mismatch");
    const key = canonicalJson([proof.eventId, proof.token]), active = this.active.get(key); if (active) return active;
    const work = this.execute(proof).finally(() => this.active.delete(key)); this.active.set(key, work); return work;
  }
  private async execute(proof: Proof): Promise<void> {
    await this.source(this.prisma, proof);
    await withoutWhatsAppExecutionForVerifiedOperation(() => this.tenant.run({ merchantId: proof.merchantId,
      userId: "service-appointment-notice", role: "system" }, async () => {
      const facts = await this.prisma.$transaction(tx => this.facts(tx, proof)); if (!facts) return;
      const presentation = this.presentation?.(Object.freeze({ appointmentId: facts.appointmentId, appointmentVersion: facts.appointmentVersion,
        recipient: facts.recipient, text: facts.text })) ?? { text: facts.text };
      if (typeof presentation.text !== "string" || !presentation.text.trim() || presentation.text.length > 4096) throw new Error("service_notice_content_invalid");
      if (presentation.mediaUrl) {
        try {
          const u = new URL(presentation.mediaUrl);
          if (u.protocol === "https:" && !u.username && !u.password) await this.deliver(proof, facts, "media", presentation.text, presentation.mediaUrl);
        } catch { /* Optional media cannot suppress the canonical text. Its own writer/lease still fences text. */ }
      }
      await this.deliver(proof, facts, "text", presentation.text);
    }));
  }
  private async source(tx: Pick<Prisma.TransactionClient, "$queryRaw" | "outboxMessage">, p: Proof, lock = false): Promise<Date> {
    if (lock) await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE event_id=${p.eventId} AND merchant_id=${p.merchantId} FOR UPDATE`;
    const row = await tx.outboxMessage.findFirst({ where: { eventId: p.eventId, merchantId: p.merchantId } });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!row || row.eventType !== p.eventType || row.schemaVersion !== 1 || row.producer !== "service-booking"
      || row.correlationId !== p.correlationId || row.causationId !== p.causationId || canonicalJson(row.payload) !== canonicalJson(p.payload)
      || row.status !== "processing" || row.leaseToken !== p.token || !(row.leaseExpiresAt instanceof Date)
      || !(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime()) || row.leaseExpiresAt <= clock.now)
      throw new Error("service_notice_lease_lost");
    return clock.now;
  }
  private async config(tx: Prisma.TransactionClient, merchantId: string): Promise<WhatsAppChannelConfigEntity | null> {
    await tx.$queryRaw`SELECT id FROM whatsapp_channel_configs WHERE merchant_id=${merchantId} FOR SHARE`;
    const row = await tx.whatsAppChannelConfig.findUnique({ where: { merchantId } });
    return row ? { ...row, credentials: decodeWhatsAppCredentials(object(row.credentials) ? row.credentials : {}),
      deviceId: row.deviceId ?? undefined, whatsappNumber: row.whatsappNumber ?? undefined, phoneNumber: row.phoneNumber ?? undefined,
      webhookSecret: row.webhookSecret ?? undefined, connectedAt: row.connectedAt ?? undefined } : null;
  }
  private scope(config: WhatsAppChannelConfigEntity, recipient: string, messageId: string): OperatorRequestScope | undefined {
    const credentials = connectedMetaCloudCredentials(config, config.merchantId); if (!credentials) return;
    const c = operatorConnection(config, { merchantId: config.merchantId, configId: config.id, deviceId: config.deviceId ?? "META_CLOUD:" + config.id,
      provider: "META_CLOUD", accountId: credentials.phoneNumberId, recipient });
    return c.kind === "ready" ? Object.freeze({ ...c.scope, messageId }) : undefined;
  }
  private async facts(tx: Prisma.TransactionClient, p: Proof): Promise<Facts | undefined> {
    await lockCatalogMerchant(tx, p.merchantId);
    const selected = await tx.serviceAppointment.findFirst({ where: { id: p.appointmentId, merchantId: p.merchantId }, select: { professionalId: true } });
    if (!selected) throw new Error("service_notice_appointment_unavailable");
    await lockServiceProfessional(tx, p.merchantId, selected.professionalId);
    await tx.$queryRaw`SELECT id FROM service_appointments WHERE id=${p.appointmentId} AND merchant_id=${p.merchantId} FOR UPDATE`;
    const a = await tx.serviceAppointment.findFirst({ where: { id: p.appointmentId, merchantId: p.merchantId } });
    if (!a || a.professionalId !== selected.professionalId || a.version < p.appointmentVersion) throw new Error("service_notice_appointment_unavailable");
    const audit = await tx.appointmentAudit.findUnique({ where: { merchantId_commandId: { merchantId: p.merchantId, commandId: p.causationId } } });
    if (!audit || audit.merchantId !== p.merchantId || audit.appointmentId !== a.id || audit.version !== p.appointmentVersion || !object(audit.after)
      || (p.eventType === SCHEDULED ? !["admit", "manual_create", "manual_payment_approved"].includes(audit.action) || audit.after.operationalStatus !== "scheduled"
        : audit.action !== "attendance_receipt" || audit.after.receiptId !== p.receiptId || audit.after.paymentId !== p.paymentId || audit.after.paymentVersion !== p.paymentVersion))
      throw new Error("service_notice_original_command_required");
    if (p.eventType === SCHEDULED && (a.version !== p.appointmentVersion || a.operationalStatus !== "scheduled")) {
      await this.source(tx, p, true); return;
    }
    await tx.$queryRaw`SELECT id FROM appointment_payments WHERE appointment_id=${a.id} AND merchant_id=${p.merchantId} FOR UPDATE`;
    const payments = await tx.appointmentPayment.findMany({ where: { appointmentId: a.id, merchantId: p.merchantId }, include: { paymentIntent: true } });
    const money = p.paymentId ? payments.find(v => v.id === p.paymentId) : payments.find(v => ["pending", "approved"].includes(v.status));
    if (!money || money.merchantId !== p.merchantId || money.appointmentId !== a.id || !Number.isSafeInteger(money.amountCents) || money.amountCents < 0 || !/^[A-Z]{3}$/.test(money.currency) || money.currency !== a.currency
      || p.paymentVersion !== undefined && money.version < p.paymentVersion) throw new Error("service_notice_finance_unavailable");
    let financial: string;
    if (p.eventType === RECEIPT) {
      const receipt = await tx.attendanceReceipt.findFirst({ where: { id: p.receiptId, merchantId: p.merchantId, appointmentPaymentId: money.id } });
      if (!receipt || money.mode !== "at_attendance" || money.paymentIntentId || !version(receipt.amountCents) || receipt.currency !== money.currency
        || !receipt.paymentMethod?.trim()) throw new Error("service_notice_receipt_unavailable");
      financial = `Recebimento registrado no atendimento: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: receipt.currency }).format(receipt.amountCents / 100)} (${inline(receipt.paymentMethod)}). Registro local, independente de confirma\u00e7\u00e3o de provedor.`;
    } else if (money.mode === "at_attendance") {
      if (money.paymentIntentId || money.provider || money.providerPaymentId || money.providerEvidence != null)
        throw new Error("service_notice_finance_unavailable");
      if (money.amountCents === 0 && a.priceInCents === 0 && ["pending", "approved"].includes(money.status)) financial = "Sem valor a pagar.";
      else if (money.status === "pending" && money.receivedAt === null) financial = "Pagamento no atendimento: pendente.";
      else if (money.status === "approved" && money.receivedAt instanceof Date && Number.isFinite(money.receivedAt.getTime())) {
        const receipts = await tx.attendanceReceipt.findMany({ where: { merchantId: p.merchantId, appointmentPaymentId: money.id } });
        if (!receipts.length || receipts.some(r => r.merchantId !== p.merchantId || r.appointmentPaymentId !== money.id
          || !version(r.amountCents) || r.currency !== money.currency || !r.operatorId?.trim() || !r.paymentMethod?.trim()
          || !(r.receivedAt instanceof Date) || !Number.isFinite(r.receivedAt.getTime()))
          || receipts.reduce((sum, r) => sum + r.amountCents, 0) !== money.amountCents) throw new Error("service_notice_finance_unavailable");
        financial = "Pagamento registrado no atendimento.";
      } else throw new Error("service_notice_finance_unavailable");
    } else {
      const external = money.paymentIntent;
      const order = a.orderId && await tx.completedOrder.findFirst({ where: { id: a.orderId, merchantId: p.merchantId } });
      const line = order && a.orderUnitId ? professionalOrderLine(order, a.orderUnitId) : undefined;
      const evidence = object(money.providerEvidence) ? money.providerEvidence : {};
      if (money.status !== "approved" || !external || external.merchantId !== p.merchantId || money.paymentIntentId !== external.id
        || !order || order.status !== "approved" || external.sessionId !== order.sessionId || money.providerPaymentId !== external.providerPaymentId
        || !fulfillmentPaymentEligible(order, external) || !line || line.variantId !== a.variantId
        || line.schedule?.professionalId !== a.professionalId || evidence.paymentIntentId !== external.id
        || evidence.currency !== external.currency || evidence.approvedAmountCents !== external.approvedAmountCents
        || (audit.action === "manual_payment_approved" ? evidence.unitId !== undefined && evidence.unitId !== a.orderUnitId : evidence.unitId !== a.orderUnitId))
        throw new Error("service_notice_finance_unavailable");
      // T35 already authorizes this exact unit at its effective discounted order
      // total. Nominal appointment price is not the approved gross PSP amount.
      financial = "Pagamento confirmado pelo provedor.";
    }
    const [professional, service, merchant, config, rule] = await Promise.all([
      tx.serviceProfessional.findFirst({ where: { id: a.professionalId, merchantId: p.merchantId } }),
      tx.product.findFirst({ where: { id: a.productId, merchantId: p.merchantId, type: "service" } }),
      tx.merchant.findUnique({ where: { id: p.merchantId }, select: { name: true } }), this.config(tx, p.merchantId), findMerchantAgentRule(tx, p.merchantId),
    ]);
    await this.source(tx, p, true);
    if (p.eventType === SCHEDULED && (a.version !== p.appointmentVersion || a.operationalStatus !== "scheduled")) return;
    const customer = object(a.customerSnapshot) ? a.customerSnapshot : {}, recipient = typeof customer.phone === "string" ? normalizeRecoveryRecipient(customer.phone) : null;
    if (!recipient || !config || !this.scope(config, recipient, "check") || !professional || !service || !merchant) return;
    const tone = checkoutTone(object(rule?.identity) ? rule.identity.tone : undefined);
    const text = formatServiceAppointmentConfirmation({ kind: p.eventType === RECEIPT ? "attendance_receipt" : "scheduled", merchantName: inline(merchant.name),
      serviceName: inline(service.name), professionalName: inline(professional.publicName), operationalStatus: a.operationalStatus,
      startsAt: a.startsAt, endsAt: a.endsAt, timeZone: a.timeZone, priceInCents: a.priceInCents, currency: a.currency, financialText: financial, tone });
    return { appointmentId: a.id, appointmentVersion: a.version, recipient, text, config,
      identity: hash([a.id, a.version, a.operationalStatus, a.startsAt, a.endsAt, a.timeZone, a.priceInCents, a.currency, money.id, money.version, money.status, financial, text, recipient, tone]) };
  }
  private async prepare(p: Proof, original: Facts, part: "media" | "text", text: string, mediaUrl?: string): Promise<Attempt | undefined> {
    return this.prisma.$transaction(async tx => {
      const facts = await this.facts(tx, p); if (!facts || facts.identity !== original.identity) return;
      const id = "service_notification:" + hash([p.merchantId, p.eventId, facts.recipient, "service_appointment_notice", part]);
      const scope = this.scope(facts.config, facts.recipient, id); if (!scope) return;
      const row = await tx.whatsAppDelivery.findUnique({ where: { id } });
      if (row) {
        if (row.merchantId !== p.merchantId || row.configId !== facts.config.id) throw new Error("service_notice_delivery_scope_mismatch");
        const metadata = object(row.response) ? row.response : {};
        if (["queued", "sending"].includes(row.state) && metadata.sourceLeaseToken !== p.token)
          await tx.whatsAppDelivery.updateMany({ where: { id, merchantId: p.merchantId, state: row.state, processingToken: row.processingToken },
            data: { state: "submission_unknown", response: { ...metadata, status: "unknown", reason: "abandoned_submission_unknown" } as Prisma.InputJsonValue } });
        return;
      }
      const token = randomUUID(), metadata = { kind: "service_notification", type: "service_appointment_notice", appointmentId: facts.appointmentId,
        sourceEventId: p.eventId, sourceEventType: p.eventType, sourceLeaseToken: p.token, part, recipientHash: hash(facts.recipient), channel: "none", providerAccountId: scope.accountId };
      await tx.whatsAppDelivery.create({ data: { id, merchantId: p.merchantId, configId: facts.config.id, deviceId: scope.deviceId,
        state: "queued", processingToken: token, response: metadata } });
      return { proof: p, id, token, scope, factsIdentity: facts.identity, metadata,
        input: Object.freeze({ merchantId: p.merchantId, appointmentId: facts.appointmentId, eventId: p.eventId, deliveryId: id,
          type: "service_appointment_notice", part, toPhone: facts.recipient, freeformText: text, variables: { appointmentSummary: text }, ...(mediaUrl ? { mediaUrl } : {}) }) };
    });
  }
  private async deliver(p: Proof, original: Facts, part: "media" | "text", text: string, mediaUrl?: string): Promise<void> {
    const attempt = await this.prepare(p, original, part, text, mediaUrl); if (!attempt) return;
    const tracker: Tracker = { invoked: false, commitUnknown: false }; let result: NotificationWhatsAppResult;
    try { result = this.sender.executeService ? await withWhatsAppSubmission({ requestScope: attempt.scope,
      startRequest: (scope, start) => this.start(attempt, tracker, scope, start) }, () => this.sender.executeService!(attempt.input))
      : { status: "skipped", channel: "none", reason: "service_transport_unavailable" }; }
    catch { result = { status: "unknown", channel: "none", reason: "provider_acceptance_unknown" }; }
    const accepted = tracker.invoked && !tracker.commitUnknown && result.status === "accepted" && !!result.messageId?.trim();
    const unknown = tracker.commitUnknown || !tracker.denied && (tracker.invoked ? !accepted && result.status !== "failed" : result.status !== "skipped" && result.status !== "failed");
    const state = accepted ? "sent" : unknown ? "submission_unknown" : "notification_failed";
    await this.prisma.$transaction(async tx => {
      await tx.whatsAppDelivery.updateMany({ where: { id: attempt.id, merchantId: p.merchantId, configId: attempt.scope.configId,
        processingToken: attempt.token, state: { in: ["queued", "sending"] } }, data: { state, providerMessageId: accepted ? result.messageId! : null,
        response: { ...attempt.metadata, status: accepted ? "accepted" : unknown ? "unknown" : "failed", channel: result.channel,
          requestInvoked: tracker.invoked, ...(tracker.denied ? { reason: tracker.denied } : result.reason ? { reason: result.reason } : {}) } as Prisma.InputJsonValue } });
    });
  }
  private async start<T>(a: Attempt, tracker: Tracker, scope: Extract<WhatsAppRequestScope, { kind: "whatsapp" }>, start: () => Promise<T>): Promise<T> {
    if (tracker.invoked || currentWhatsAppSubmissionScope() !== a.scope || canonicalJson(scope) !== canonicalJson(a.scope)) {
      tracker.denied = "channel_context_changed"; throw new NotStarted(tracker.denied);
    }
    let pending: Promise<T> | undefined;
    try {
      await this.prisma.$transaction(async tx => {
        const facts = await this.facts(tx, a.proof);
        if (!facts || facts.identity !== a.factsIdentity || canonicalJson(this.scope(facts.config, facts.recipient, a.id)) !== canonicalJson(a.scope)) throw new NotStarted("appointment_or_channel_changed");
        const changed = await tx.whatsAppDelivery.updateMany({ where: { id: a.id, merchantId: a.proof.merchantId, configId: a.scope.configId,
          processingToken: a.token, state: "queued" }, data: { state: "sending" } });
        if (changed.count !== 1) throw new NotStarted("service_notice_attempt_changed");
        const transport = currentServiceNoticeTransport();
        if (!transport) throw new NotStarted("service_transport_proof_required");
        if (a.input.part === "media" && transport.kind !== "session") throw new NotStarted("service_media_requires_session");
        let template: PostSaleMessageTemplate | null = null;
        let inbound: WhatsAppWebhookInbox | null = null;
        if (transport.kind === "template") {
          await tx.$queryRaw`SELECT id FROM post_sale_message_templates WHERE id=${transport.template.id} AND merchant_id=${a.proof.merchantId} FOR SHARE`;
          template = await tx.postSaleMessageTemplate.findFirst({ where: { id: transport.template.id, merchantId: a.proof.merchantId,
            type: "service_appointment_notice", channel: "whatsapp" } });
        } else inbound = await tx.whatsAppWebhookInbox.findFirst({ where: { merchantId: a.proof.merchantId, configId: a.scope.configId,
          deviceId: a.scope.deviceId, kind: "message", AND: [
            { payload: { path: ["provider"], equals: "META_CLOUD" } }, { payload: { path: ["merchantId"], equals: a.proof.merchantId } },
            { payload: { path: ["deviceId"], equals: a.scope.deviceId } },
            { OR: [a.input.toPhone, a.input.toPhone.slice(1)].map(fromNumber => ({ payload: { path: ["fromNumber"], equals: fromNumber } })) },
          ] }, orderBy: { createdAt: "desc" } });
        // Fresh clock is AFTER every awaited eligibility read/write. Template,
        // booking/config and original source ownership remain locked until start.
        const now = await this.source(tx, a.proof, true);
        if (transport.kind === "template") {
          const p = transport.template, credentials = connectedMetaCloudCredentials(facts.config, a.proof.merchantId);
          if (!template || template.merchantId !== a.proof.merchantId || template.type !== "service_appointment_notice" || template.channel !== "whatsapp"
            || !template.isActive || template.metaStatus !== "approved" || template.id !== p.id || template.metaRevision !== p.revision
            || template.metaWabaId !== p.wabaId || !credentials || credentials.wabaId !== p.wabaId || (template.metaLanguage ?? "pt_BR") !== p.language
            || template.metaCategory !== "UTILITY" || p.category !== "UTILITY" || template.twilioContentSid !== p.contentSid
            || template.metaTemplateBody !== p.body || canonicalJson(template.metaVariableMap) !== canonicalJson(p.variableMap)
            || !(template.metaLastCheckedAt instanceof Date) || template.metaLastCheckedAt > now
            || now.getTime() - template.metaLastCheckedAt.getTime() >= 15 * 60000) throw new NotStarted("service_template_changed");
        } else {
          const payload = inbound && object(inbound.payload) ? inbound.payload : {}, timestamp = payload.timestamp;
          if (!inbound || !(inbound.createdAt instanceof Date) || payload.ignored === true || payload.provider !== "META_CLOUD"
            || payload.merchantId !== a.proof.merchantId || payload.deviceId !== a.scope.deviceId || typeof payload.fromNumber !== "string"
            || normalizeRecoveryRecipient(payload.fromNumber) !== a.input.toPhone || typeof timestamp !== "number" || !Number.isSafeInteger(timestamp)
            || timestamp > now.getTime() || now.getTime() - Math.min(timestamp, inbound.createdAt.getTime()) >= 24 * 3600000)
            throw new NotStarted("service_window_unavailable");
        }
        tracker.invoked = true; pending = start(); pending.catch(() => {});
      });
    } catch (error) {
      if (tracker.invoked) { tracker.commitUnknown = true; await pending?.catch(() => undefined); }
      else tracker.denied = error instanceof NotStarted ? error.message : "dispatch_authority_lost";
      throw error;
    }
    if (!pending) throw new NotStarted("service_notice_not_started"); return pending;
  }
}
