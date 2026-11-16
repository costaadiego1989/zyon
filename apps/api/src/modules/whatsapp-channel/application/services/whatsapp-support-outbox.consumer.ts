import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";
import type { Prisma, PrismaClient, MerchantUser } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { currentWhatsAppSubmissionScope, withWhatsAppSubmission, withoutWhatsAppExecutionForVerifiedOperation,
  type WhatsAppRequestScope, type WhatsAppSubmission } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { lockSupportResource } from "../../../support/application/support-persistence.js";
import { WHATSAPP_SUPPORT_MESSAGE_REQUESTED } from "../../../support/application/send-ticket-message.use-case.js";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort, type WhatsAppSendResult } from "../../domain/ports/whatsapp-sender.port.js";
import type { WhatsAppChannelConfigEntity } from "../../domain/ports/whatsapp-config-repository.port.js";
import { operatorConnection, type OperatorConnection, type OperatorRequestScope } from "../../domain/services/whatsapp-operator-connection.js";
import { parseOperatorDispatch, ownsOperatorDispatch, classifyOperatorSubmission,
  type OperatorDispatchProof, type OperatorOutboxRow, type OperatorDeliveryCandidate } from "../../domain/services/whatsapp-operator-delivery.js";
import { whatsappE164 } from "../../domain/services/whatsapp-phone.js";
import { PrismaWhatsAppHandoffRepository, type LockedWhatsAppConversation } from "../../infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { decodeWhatsAppCredentials } from "../../infrastructure/repositories/whatsapp-credential-codec.js";
import { readStoredOperatorAuthority, loadOperatorMessageWithin, saveOperatorDeliveryWithin,
  type StoredOperatorAuthority, type StoredOperatorCommand } from "./whatsapp-support-message-state.js";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const scopeOf = (a: StoredOperatorAuthority) => ({ merchantId: a.merchantId, configId: a.configId, whatsappSessionId: a.whatsappSessionId });
const WINDOW_MS = 24 * 60 * 60 * 1000;
class OperatorNotStarted extends Error { constructor(readonly code: string) { super(code); } }
interface Facts { connection: OperatorConnection; member: MerchantUser | null }
interface Attempt {
  proof: Readonly<OperatorDispatchProof>; authority: Readonly<StoredOperatorAuthority>; token: string;
  requestScope: OperatorRequestScope; text: string;
}
interface RequestTracker { invoked: boolean; commitUnknown: boolean; denied?: string }

@Injectable()
export class WhatsAppSupportOutboxConsumer implements OnModuleInit {
  private readonly active = new Map<string, Promise<void>>();
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient, private readonly bindings: PrismaWhatsAppHandoffRepository,
    @Inject(WHATSAPP_SENDER_PORT) private readonly sender: WhatsAppSenderPort,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus, private readonly tenant: TenantContextService) {}

  onModuleInit(): void {
    this.events.subscribe(WHATSAPP_SUPPORT_MESSAGE_REQUESTED, event => this.handle(event), "whatsapp.support.message.delivery.v1");
  }
  handle(event: DomainEvent): Promise<void> {
    const proof = parseOperatorDispatch(event); if (!proof) return Promise.reject(new Error("operator_dispatch_proof_required"));
    const key = JSON.stringify([proof.eventId, proof.leaseToken]), previous = this.active.get(key); if (previous) return previous;
    const task = this.execute(proof).finally(() => this.active.delete(key)); this.active.set(key, task); return task;
  }
  private async execute(proof: Readonly<OperatorDispatchProof>): Promise<void> {
    const context = this.tenant.get(); if (context && context.merchantId !== proof.merchantId) throw new Error("operator_dispatch_scope_mismatch");
    const event = await this.prisma.outboxMessage.findFirst({ where: { eventId: proof.eventId, merchantId: proof.merchantId } });
    const [clock] = await this.prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!clock || !ownsOperatorDispatch(proof, event, clock.now)) throw new Error("operator_dispatch_lease_lost");
    const row = await this.prisma.whatsAppDelivery.findFirst({ where: { id: proof.correlationId, merchantId: proof.merchantId } });
    const authority = row && readStoredOperatorAuthority(row, proof); if (!authority) throw new Error("operator_original_command_required");
    // Exact durable dispatch + human command proof, not the event's name, permits
    // this operation to leave any inline AI frame. Every writer rechecks it.
    await withoutWhatsAppExecutionForVerifiedOperation(() => this.tenant.run({ merchantId: proof.merchantId,
      userId: "whatsapp-support-outbox", role: "system" }, () => this.process(proof, authority)));
  }
  private async process(proof: Readonly<OperatorDispatchProof>, authority: Readonly<StoredOperatorAuthority>): Promise<void> {
    let attempt: Attempt | undefined;
    try { attempt = await this.prepare(proof, authority); }
    catch (error) {
      if (["whatsapp_handoff_session_not_found", "whatsapp_handoff_scope_not_found", "whatsapp_handoff_config_changed"].includes(String(error instanceof Error ? error.message : ""))) {
        await this.failQueued(proof, authority, "channel_context_changed"); return;
      }
      throw error;
    }
    if (!attempt) return;
    const tracker: RequestTracker = { invoked: false, commitUnknown: false };
    const frame: WhatsAppSubmission = { requestScope: attempt.requestScope,
      startRequest: <T>(scope: Extract<WhatsAppRequestScope, { kind: "whatsapp" }>, start: () => Promise<T>) => this.start(attempt!, tracker, scope, start) };
    let result: WhatsAppSendResult;
    try {
      result = await withWhatsAppSubmission(frame, () => this.sender.sendText(Object.freeze({ provider: authority.provider,
        deviceId: authority.deviceId, toNumber: authority.recipient, text: attempt!.text, correlationId: proof.correlationId })));
    } catch { result = { status: "unknown", messageId: "" }; }
    const candidate: OperatorDeliveryCandidate = tracker.commitUnknown ? { status: "unknown", providerMessageId: null, errorCode: "submission_unknown" }
      : tracker.denied ? { status: "failed", providerMessageId: null, errorCode: tracker.denied }
      : classifyOperatorSubmission(tracker.invoked ? "started" : result.status === "failed" ? "not_started" : "unknown", result);
    await this.finish(attempt, candidate, tracker);
  }
  private async prepare(proof: Readonly<OperatorDispatchProof>, authority: Readonly<StoredOperatorAuthority>): Promise<Attempt | undefined> {
    return this.bindings.withReadLock(scopeOf(authority), async (tx, locked) => {
      await lockSupportResource(tx, "support:" + proof.ticketId);
      const facts = await this.facts(tx, authority);
      const command = await loadOperatorMessageWithin(tx, proof, authority);
      const event = await this.lockEvent(tx, proof), clock = await this.clock(tx);
      if (!ownsOperatorDispatch(proof, event, clock)) throw new Error("operator_dispatch_lease_lost");
      if (command.projection.status !== "queued") return;
      if (command.row.state === "preparing" || command.row.state === "started") {
        // Recovery cannot tell whether an abandoned callback reached a provider.
        await saveOperatorDeliveryWithin(tx, command, { status: "unknown", providerMessageId: null, errorCode: "submission_unknown" }); return;
      }
      if (command.row.state !== "queued" || command.row.processingToken !== "not_started") throw new Error("operator_attempt_state_invalid");
      const denied = this.denied(command, locked, facts) ?? (!await this.windowOpen(tx, authority, clock) ? "service_window_unavailable" : undefined);
      if (denied) { await saveOperatorDeliveryWithin(tx, command, { status: "failed", providerMessageId: null, errorCode: denied }); return; }
      if (facts.connection.kind !== "ready") throw new Error("operator_connection_required");
      const token = randomUUID(), requestScope = Object.freeze({ ...facts.connection.scope, messageId: proof.correlationId });
      await saveOperatorDeliveryWithin(tx, command, { status: "queued", providerMessageId: null }, { internalState: "preparing", processingToken: token,
        privatePatch: { submission: { attemptToken: token, outboxEventId: proof.eventId, outboxLeaseToken: proof.leaseToken,
          credentialDigest: requestScope.credentialDigest, phase: "preparing" } } });
      return { proof, authority, token, requestScope, text: command.message.content };
    });
  }
  private async start<T>(attempt: Attempt, tracker: RequestTracker, actual: Extract<WhatsAppRequestScope, { kind: "whatsapp" }>, start: () => Promise<T>): Promise<T> {
    if (tracker.invoked || canonicalJson(actual) !== canonicalJson(attempt.requestScope)
      || currentWhatsAppSubmissionScope() !== attempt.requestScope) { tracker.denied = "channel_context_changed"; throw new OperatorNotStarted(tracker.denied); }
    let pending: Promise<T> | undefined;
    try {
      await this.bindings.withReadLock(scopeOf(attempt.authority), async (tx, locked) => {
        await lockSupportResource(tx, "support:" + attempt.proof.ticketId);
        const facts = await this.facts(tx, attempt.authority);
        const command = await loadOperatorMessageWithin(tx, attempt.proof, attempt.authority);
        const event = await this.lockEvent(tx, attempt.proof);
        if (command.row.state !== "preparing" || command.row.processingToken !== attempt.token
          || !this.ownsAttempt(command, attempt)) throw new OperatorNotStarted("conversation_changed");
        const denied = this.denied(command, locked, facts);
        if (denied) throw new OperatorNotStarted(denied);
        if (facts.connection.kind !== "ready" || canonicalJson({ ...facts.connection.scope, messageId: attempt.proof.correlationId }) !== canonicalJson(attempt.requestScope)) throw new OperatorNotStarted("channel_context_changed");
        await saveOperatorDeliveryWithin(tx, command, { status: "queued", providerMessageId: null }, { internalState: "started",
          privatePatch: { submission: { ...this.attemptJson(attempt), phase: "started" } } });
        // All locks/SQL writes precede the final fresh clock. A wait cannot
        // authorize a request using a timestamp captured before that wait.
        const inbound = await this.latestInbound(tx, attempt.authority), now = await this.clock(tx);
        if (!ownsOperatorDispatch(attempt.proof, event, now)) throw new OperatorNotStarted("dispatch_lease_lost");
        if (!this.validInbound(inbound, attempt.authority, now)) throw new OperatorNotStarted("service_window_unavailable");
        tracker.invoked = true; pending = start(); pending.catch(() => {});
        return { submission: true };
      });
    } catch (error) {
      if (tracker.invoked) {
        tracker.commitUnknown = true;
        if (pending) { const response = await pending.catch(() => undefined); if (response instanceof Response) await response.body?.cancel().catch(() => undefined); }
      } else if (error instanceof OperatorNotStarted) tracker.denied = error.code;
      throw error;
    }
    if (!pending) throw new OperatorNotStarted("submission_not_started");
    return pending;
  }
  private async finish(attempt: Attempt, candidate: OperatorDeliveryCandidate, tracker: RequestTracker): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, "support:" + attempt.proof.ticketId);
      const command = await loadOperatorMessageWithin(tx, attempt.proof, attempt.authority);
      if (command.row.processingToken !== attempt.token || !this.ownsAttempt(command, attempt)) return;
      // This exact already-issued attempt is historical evidence. Closing or
      // reassigning a case cannot authorize a second request or erase its result.
      await saveOperatorDeliveryWithin(tx, command, candidate, { privatePatch: {
        submission: { ...this.attemptJson(attempt), phase: candidate.status, requestInvoked: tracker.invoked, commitUnknown: tracker.commitUnknown },
      } });
    });
  }
  private async failQueued(proof: Readonly<OperatorDispatchProof>, authority: Readonly<StoredOperatorAuthority>, code: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, "support:" + proof.ticketId); const command = await loadOperatorMessageWithin(tx, proof, authority);
      const event = await this.lockEvent(tx, proof), now = await this.clock(tx);
      if (!ownsOperatorDispatch(proof, event, now)) throw new Error("operator_dispatch_lease_lost");
      if (command.row.state === "queued" && command.row.processingToken === "not_started")
        await saveOperatorDeliveryWithin(tx, command, { status: "failed", providerMessageId: null, errorCode: code });
    });
  }
  private attemptJson(attempt: Attempt) { return { attemptToken: attempt.token, outboxEventId: attempt.proof.eventId,
    outboxLeaseToken: attempt.proof.leaseToken, credentialDigest: attempt.requestScope.credentialDigest }; }
  private ownsAttempt(command: StoredOperatorCommand, attempt: Attempt): boolean {
    const value = object(command.response.submission);
    return value.attemptToken === attempt.token && value.outboxEventId === attempt.proof.eventId && value.outboxLeaseToken === attempt.proof.leaseToken
      && value.credentialDigest === attempt.requestScope.credentialDigest;
  }
  private async lockEvent(tx: Prisma.TransactionClient, proof: OperatorDispatchProof): Promise<OperatorOutboxRow | null> {
    await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE event_id=${proof.eventId} AND merchant_id=${proof.merchantId} FOR UPDATE`;
    return tx.outboxMessage.findFirst({ where: { eventId: proof.eventId, merchantId: proof.merchantId } });
  }
  private async clock(tx: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<Date> {
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!clock || !(clock.now instanceof Date) || !Number.isFinite(clock.now.getTime())) throw new Error("operator_sql_clock_unavailable"); return clock.now;
  }
  private async facts(tx: Prisma.TransactionClient, authority: StoredOperatorAuthority): Promise<Facts> {
    await tx.$queryRaw`SELECT id FROM whatsapp_channel_configs WHERE id=${authority.configId} AND merchant_id=${authority.merchantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM merchant_users WHERE id=${authority.operatorId} AND merchant_id=${authority.merchantId} FOR SHARE`;
    const [raw, member] = await Promise.all([
      tx.whatsAppChannelConfig.findFirst({ where: { id: authority.configId, merchantId: authority.merchantId } }),
      tx.merchantUser.findFirst({ where: { id: authority.operatorId, merchantId: authority.merchantId } }),
    ]);
    if (!raw) return { member, connection: { kind: "unavailable", code: "channel_identity_unavailable" } };
    const config: WhatsAppChannelConfigEntity = { ...raw, credentials: decodeWhatsAppCredentials(object(raw.credentials)),
      whatsappNumber: raw.whatsappNumber ?? undefined, deviceId: raw.deviceId ?? undefined, phoneNumber: raw.phoneNumber ?? undefined,
      webhookSecret: raw.webhookSecret ?? undefined, connectedAt: raw.connectedAt ?? undefined };
    return { member, connection: operatorConnection(config, authority) };
  }
  private denied(command: StoredOperatorCommand, locked: LockedWhatsAppConversation, facts: Facts): string | undefined {
    const a = command.authority, binding = locked.binding;
    if (!binding || binding.id !== a.bindingId || binding.mode !== "human" || binding.epoch !== a.epoch || binding.ticketId !== a.ticketId
      || binding.assignedOperatorId !== a.operatorId || command.ticket.status !== "in_progress" || command.ticket.mergedIntoId !== null
      || command.ticket.assignedTo !== a.operatorId || locked.session.deviceId !== a.deviceId || whatsappE164(locked.session.buyerPhone) !== a.recipient)
      return "conversation_changed";
    if (!facts.member || facts.member.disabledAt !== null || !["owner", "admin", "staff"].includes(facts.member.role.toLowerCase())) return "operator_unavailable";
    return facts.connection.kind === "unavailable" ? facts.connection.code : undefined;
  }
  private async latestInbound(tx: Prisma.TransactionClient, authority: StoredOperatorAuthority) {
    const streamKey = createHash("sha256").update(JSON.stringify([authority.merchantId, authority.configId, "message", authority.recipient.replace(/\D/g, "")])).digest("hex");
    return tx.whatsAppWebhookInbox.findFirst({ where: { merchantId: authority.merchantId, configId: authority.configId,
      deviceId: authority.deviceId, kind: "message", streamKey }, orderBy: { createdAt: "desc" } });
  }
  private validInbound(inbound: Awaited<ReturnType<WhatsAppSupportOutboxConsumer["latestInbound"]>>, authority: StoredOperatorAuthority, now: Date): boolean {
    if (!inbound) return false; const payload = object(inbound.payload), timestamp = payload.timestamp;
    return payload.ignored !== true && payload.merchantId === authority.merchantId && payload.deviceId === authority.deviceId && payload.provider === authority.provider
      && typeof payload.fromNumber === "string" && whatsappE164(payload.fromNumber) === authority.recipient && typeof timestamp === "number"
      && Number.isSafeInteger(timestamp) && timestamp >= 0 && now.getTime() - Math.min(timestamp, inbound.createdAt.getTime()) < WINDOW_MS;
  }
  private async windowOpen(tx: Prisma.TransactionClient, authority: StoredOperatorAuthority, now: Date): Promise<boolean> {
    return this.validInbound(await this.latestInbound(tx, authority), authority, now);
  }
}
