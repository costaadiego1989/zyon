import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { currentWhatsAppSubmissionScope, withWhatsAppSubmission, withoutWhatsAppExecutionForVerifiedOperation,
  type WhatsAppRequestScope } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort, type WhatsAppSendResult } from "../../../whatsapp-channel/domain/ports/whatsapp-sender.port.js";
import { WHATSAPP_TEMPLATE_SENDER, type WhatsAppTemplateSenderPort, type TemplateSendResult } from "../../../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js";
import { operatorConnection, type OperatorRequestScope } from "../../../whatsapp-channel/domain/services/whatsapp-operator-connection.js";
import { PrismaWhatsAppHandoffRepository, type LockedWhatsAppConversation } from "../../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { STAFF_ALERT_REQUESTED, object, parseStaffAlertDispatch, ownsStaffAlertDispatch, staffWindowOpen, staffTemplateSnapshot,
  type StaffAlertProof, type StaffAlertAuthority, type StaffAlertCandidate, type StaffTemplate } from "../../domain/support-case-alert.js";
import { lockSupportResource } from "../support-persistence.js";
import { loadStaffAlertWithin, saveStaffAlertWithin, staffConfig, type StaffAlertCommand } from "../support-case-alert-state.js";

type Transport = { kind: "session" } | { kind: "template"; template: StaffTemplate };
interface Attempt { proof: Readonly<StaffAlertProof>; authority: StaffAlertAuthority; token: string; requestScope: OperatorRequestScope;
  transport: Transport; text: string; storeName: string; link: string }
interface Tracker { invoked: boolean; commitUnknown: boolean; denied?: string }
class NotStarted extends Error { constructor(readonly code: string) { super(code); } }
const scopeOf = (a: StaffAlertAuthority) => ({ merchantId: a.merchantId, configId: a.configId, whatsappSessionId: a.whatsappSessionId });

@Injectable()
export class SupportCaseAlertConsumer implements OnModuleInit {
  private readonly active = new Map<string, Promise<void>>();
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient, private readonly bindings: PrismaWhatsAppHandoffRepository,
    @Inject(WHATSAPP_SENDER_PORT) private readonly sender: WhatsAppSenderPort,
    @Inject(WHATSAPP_TEMPLATE_SENDER) private readonly templates: WhatsAppTemplateSenderPort,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus, private readonly tenant: TenantContextService) {}
  onModuleInit(): void { this.events.subscribe(STAFF_ALERT_REQUESTED, event => this.handle(event), "whatsapp.support.case-alert.v1"); }
  handle(event: DomainEvent): Promise<void> {
    const proof = parseStaffAlertDispatch(event); if (!proof) return Promise.reject(new Error("staff_alert_dispatch_required"));
    const key = canonicalJson([proof.eventId, proof.leaseToken]), existing = this.active.get(key); if (existing) return existing;
    const task = this.execute(proof).finally(() => this.active.delete(key)); this.active.set(key, task); return task;
  }
  private async execute(proof: Readonly<StaffAlertProof>): Promise<void> {
    if (this.tenant.get() && this.tenant.get()!.merchantId !== proof.merchantId) throw new Error("staff_alert_scope_mismatch");
    const event = await this.prisma.outboxMessage.findFirst({ where: { eventId: proof.eventId, merchantId: proof.merchantId } });
    if (!ownsStaffAlertDispatch(proof, event, await this.clock(this.prisma))) throw new Error("staff_alert_dispatch_lease_lost");
    const original = await loadStaffAlertWithin(this.prisma, proof);
    await withoutWhatsAppExecutionForVerifiedOperation(() => this.tenant.run({ merchantId: original.authority.merchantId,
      userId: "whatsapp-staff-alert-outbox", role: "system" }, () => this.process(proof, original.authority)));
  }
  private async process(proof: Readonly<StaffAlertProof>, authority: StaffAlertAuthority): Promise<void> {
    let attempt: Attempt | undefined;
    try { attempt = await this.prepare(proof, authority); }
    catch (error) {
      if (!["whatsapp_handoff_session_not_found", "whatsapp_handoff_scope_not_found", "whatsapp_handoff_config_changed"].includes(error instanceof Error ? error.message : "")) throw error;
      await this.prisma.$transaction(async tx => { await lockSupportResource(tx, "support:" + proof.ticketId);
        const command = await loadStaffAlertWithin(tx, proof), event = await this.lockEvent(tx, proof);
        if (!ownsStaffAlertDispatch(proof, event, await this.clock(tx))) throw new Error("staff_alert_dispatch_lease_lost");
        if (command.row.state === "queued" && command.row.processingToken === "not_started") await saveStaffAlertWithin(tx, command, { status: "unavailable", providerMessageId: null, errorCode: "conversation_unavailable" });
      }); return;
    }
    if (!attempt) return;
    const tracker: Tracker = { invoked: false, commitUnknown: false };
    let result: WhatsAppSendResult | TemplateSendResult;
    try {
      result = await withWhatsAppSubmission({ requestScope: attempt.requestScope,
        startRequest: (scope, start) => this.start(attempt!, tracker, scope, start) }, () => attempt!.transport.kind === "session"
        ? this.sender.sendText({ provider: authority.provider, deviceId: authority.deviceId, toNumber: authority.recipient!, text: attempt!.text, correlationId: proof.alertId })
        : this.templates.sendTemplate({ merchantId: authority.merchantId, correlationId: proof.alertId, type: "support_case_alert", toNumber: authority.recipient!,
          contentSid: attempt!.transport.template.contentSid, language: attempt!.transport.template.language,
          contentVariables: { "1": attempt!.storeName, "2": attempt!.link } }));
    } catch { result = { status: "unknown", messageId: "" }; }
    const candidate: StaffAlertCandidate = tracker.commitUnknown ? { status: "unknown", providerMessageId: null, errorCode: "submission_unknown" }
      : tracker.denied ? { status: "unavailable", providerMessageId: null, errorCode: tracker.denied }
        : !tracker.invoked ? result.status === "failed" || result.status === "skipped"
          ? { status: "unavailable", providerMessageId: null, errorCode: "submission_not_started" }
          : { status: "unknown", providerMessageId: null, errorCode: "submission_unknown" }
          : (result.status === "sent" || result.status === "queued") && typeof result.messageId === "string" && result.messageId.length > 0
            && result.messageId.length <= 1024 && !/[\s\u0000-\u001f\u007f]/.test(result.messageId)
            ? { status: "accepted", providerMessageId: result.messageId }
            : result.status === "failed" ? { status: "failed", providerMessageId: null, errorCode: "provider_rejected" }
              : { status: "unknown", providerMessageId: null, errorCode: "submission_unknown" };
    await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, "support:" + proof.ticketId); const command = await loadStaffAlertWithin(tx, proof);
      if (!this.ownsAttempt(command, attempt!)) return;
      await saveStaffAlertWithin(tx, command, candidate, { submission: { ...this.submission(attempt!), phase: candidate.status,
        requestInvoked: tracker.invoked, commitUnknown: tracker.commitUnknown } });
    });
  }
  private async prepare(proof: Readonly<StaffAlertProof>, authority: StaffAlertAuthority): Promise<Attempt | undefined> {
    return this.bindings.withReadLock(scopeOf(authority), async (tx, locked) => {
      await lockSupportResource(tx, "support:" + proof.ticketId);
      const command = await loadStaffAlertWithin(tx, proof), event = await this.lockEvent(tx, proof);
      if (!ownsStaffAlertDispatch(proof, event, await this.clock(tx))) throw new Error("staff_alert_dispatch_lease_lost");
      if (command.delivery.status !== "queued") return;
      if (["preparing", "started"].includes(command.row.state)) {
        await saveStaffAlertWithin(tx, command, { status: "unknown", providerMessageId: null, errorCode: "submission_unknown" }); return;
      }
      if (command.row.state !== "queued" || command.row.processingToken !== "not_started") throw new Error("staff_alert_attempt_invalid");
      const facts = await this.facts(tx, authority), denied = this.denied(locked, command, facts);
      const now = await this.clock(tx), transport = denied ? undefined : await this.transport(tx, authority, facts.config.credentials.wabaId, now);
      if (denied || !transport || facts.connection.kind !== "ready") {
        await saveStaffAlertWithin(tx, command, { status: "unavailable", providerMessageId: null, errorCode: denied ?? "recipient_window_or_template_unavailable" }); return;
      }
      const attempt: Attempt = { proof, authority, token: randomUUID(), requestScope: Object.freeze({ ...facts.connection.scope, messageId: proof.alertId }),
        transport, text: command.text, storeName: command.storeName, link: command.link };
      await saveStaffAlertWithin(tx, command, { status: "queued", providerMessageId: null }, { state: "preparing", token: attempt.token,
        submission: { ...this.submission(attempt), phase: "preparing" } });
      return attempt;
    });
  }
  private async start<T>(attempt: Attempt, tracker: Tracker, actual: Extract<WhatsAppRequestScope, { kind: "whatsapp" }>, start: () => Promise<T>): Promise<T> {
    if (tracker.invoked || currentWhatsAppSubmissionScope() !== attempt.requestScope || canonicalJson(actual) !== canonicalJson(attempt.requestScope)) {
      tracker.denied = "channel_context_changed"; throw new NotStarted(tracker.denied);
    }
    let pending: Promise<T> | undefined;
    try {
      await this.bindings.withReadLock(scopeOf(attempt.authority), async (tx, locked) => {
        await lockSupportResource(tx, "support:" + attempt.proof.ticketId);
        const command = await loadStaffAlertWithin(tx, attempt.proof), event = await this.lockEvent(tx, attempt.proof);
        if (command.row.state !== "preparing" || !this.ownsAttempt(command, attempt)) throw new NotStarted("attempt_changed");
        const facts = await this.facts(tx, attempt.authority), denied = this.denied(locked, command, facts);
        if (denied) throw new NotStarted(denied);
        if (facts.connection.kind !== "ready" || canonicalJson({ ...facts.connection.scope, messageId: attempt.proof.alertId }) !== canonicalJson(actual)) throw new NotStarted("channel_context_changed");
        await saveStaffAlertWithin(tx, command, { status: "queued", providerMessageId: null }, { state: "started", submission: { ...this.submission(attempt), phase: "started" } });
        // This clock is fresh AFTER all waits, locks and writes, immediately
        // before the synchronous initiation. No fresh epoch or recipient is adopted.
        const inbound = attempt.transport.kind === "session" ? await this.inbound(tx, attempt.authority) : undefined;
        const template = attempt.transport.kind === "template" ? await this.templateRow(tx, attempt.authority) : undefined;
        const finalClock = await this.clock(tx);
        if (!ownsStaffAlertDispatch(attempt.proof, event, finalClock)) throw new NotStarted("dispatch_lease_lost");
        if (attempt.transport.kind === "session" ? !staffWindowOpen(inbound, attempt.authority, finalClock)
          : canonicalJson(staffTemplateSnapshot(template, attempt.authority.merchantId, attempt.transport.template.wabaId, finalClock) ?? null) !== canonicalJson(attempt.transport.template))
          throw new NotStarted("recipient_window_or_template_changed");
        tracker.invoked = true; pending = start(); pending.catch(() => {});
      });
    } catch (error) {
      if (tracker.invoked) { tracker.commitUnknown = true;
        const value = await pending?.catch(() => undefined); if (value instanceof Response) await value.body?.cancel().catch(() => undefined);
      } else if (error instanceof NotStarted) tracker.denied = error.code;
      throw error;
    }
    if (!pending) throw new NotStarted("submission_not_started"); return pending;
  }
  private async facts(tx: Prisma.TransactionClient, a: StaffAlertAuthority) {
    await tx.$queryRaw`SELECT id FROM merchants WHERE id=${a.merchantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM whatsapp_channel_configs WHERE id=${a.configId} AND merchant_id=${a.merchantId} FOR SHARE`;
    const setting = await tx.supportNotificationSetting.findUnique({ where: { merchantId: a.merchantId } });
    const raw = await tx.whatsAppChannelConfig.findFirstOrThrow({ where: { id: a.configId, merchantId: a.merchantId } });
    const config = staffConfig(raw), ticket = await tx.supportTicket.findFirst({ where: { id: a.ticketId, merchantId: a.merchantId } });
    const connection = a.recipient && a.accountId ? operatorConnection(config, { ...a, recipient: a.recipient, accountId: a.accountId })
      : { kind: "unavailable" as const, code: "channel_identity_unavailable" as const };
    return { setting, config, ticket, connection };
  }
  private denied(locked: LockedWhatsAppConversation, command: StaffAlertCommand, facts: Awaited<ReturnType<SupportCaseAlertConsumer["facts"]>>): string | undefined {
    const a = command.authority, binding = locked.binding;
    if (!binding || binding.id !== a.bindingId || binding.ticketId !== a.ticketId || binding.epoch < a.creationEpoch || !["waiting_human", "human"].includes(binding.mode)
      || locked.session.id !== a.whatsappSessionId || locked.session.deviceId !== a.deviceId || !facts.ticket || facts.ticket.sessionId !== a.whatsappSessionId
      || facts.ticket.source !== "whatsapp" || facts.ticket.mergedIntoId !== null || !["open", "in_progress"].includes(facts.ticket.status)) return "conversation_changed";
    if (!a.recipient || !facts.setting || facts.setting.fallbackWhatsapp !== a.recipient || facts.setting.version !== a.settingsVersion) return "recipient_changed";
    if (facts.connection.kind !== "ready") return facts.connection.code;
    return facts.connection.scope.credentialDigest !== a.credentialDigest ? "channel_context_changed" : undefined;
  }
  private async inbound(tx: Prisma.TransactionClient, a: StaffAlertAuthority) {
    const streamKey = createHash("sha256").update(JSON.stringify([a.merchantId, a.configId, "message", a.recipient!.replace(/\D/g, "")])).digest("hex");
    return tx.whatsAppWebhookInbox.findFirst({ where: { merchantId: a.merchantId, configId: a.configId, deviceId: a.deviceId, kind: "message", streamKey }, orderBy: { createdAt: "desc" } });
  }
  private async template(tx: Prisma.TransactionClient, a: StaffAlertAuthority, wabaId: unknown, now: Date) {
    if (a.provider !== "META_CLOUD" || typeof wabaId !== "string") return;
    return staffTemplateSnapshot(await this.templateRow(tx, a), a.merchantId, wabaId, now);
  }
  private async templateRow(tx: Prisma.TransactionClient, a: StaffAlertAuthority) {
    await tx.$queryRaw`SELECT id FROM post_sale_message_templates WHERE merchant_id=${a.merchantId} AND type='support_case_alert' AND channel='whatsapp' FOR SHARE`;
    return tx.postSaleMessageTemplate.findFirst({ where: { merchantId: a.merchantId, type: "support_case_alert", channel: "whatsapp" } });
  }
  private async transport(tx: Prisma.TransactionClient, a: StaffAlertAuthority, wabaId: unknown, now: Date): Promise<Transport | undefined> {
    if (staffWindowOpen(await this.inbound(tx, a), a, now)) return { kind: "session" };
    const template = await this.template(tx, a, wabaId, now); return template ? { kind: "template", template } : undefined;
  }
  private submission(a: Attempt) { return { attemptToken: a.token, outboxEventId: a.proof.eventId, outboxLeaseToken: a.proof.leaseToken,
    credentialDigest: a.requestScope.credentialDigest, ...(a.authority.providerAccountId ? { providerAccountId: a.authority.providerAccountId } : {}),
    ...(a.authority.sender ? { sender: a.authority.sender } : {}), transport: a.transport }; }
  private ownsAttempt(command: StaffAlertCommand, a: Attempt): boolean {
    const submission = object(command.response.submission), expected = this.submission(a);
    return command.row.processingToken === a.token && Object.entries(expected).every(([key, value]) => canonicalJson(submission[key] ?? null) === canonicalJson(value ?? null));
  }
  private async lockEvent(tx: Prisma.TransactionClient, proof: StaffAlertProof) {
    await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE event_id=${proof.eventId} AND merchant_id=${proof.merchantId} FOR UPDATE`;
    return tx.outboxMessage.findFirst({ where: { eventId: proof.eventId, merchantId: proof.merchantId } });
  }
  private async clock(tx: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<Date> {
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!clock || !(clock.now instanceof Date) || !Number.isFinite(clock.now.getTime())) throw new Error("staff_alert_sql_clock_unavailable"); return clock.now;
  }
}
