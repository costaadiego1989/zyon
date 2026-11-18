import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { MerchantUser, Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { currentWhatsAppSubmissionScope, withWhatsAppSubmission, withoutWhatsAppExecutionForVerifiedOperation,
  type WhatsAppRequestScope, type WhatsAppSubmission } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { lockSupportResource } from "../../../support/application/support-persistence.js";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort, type WhatsAppSendResult } from "../../domain/ports/whatsapp-sender.port.js";
import type { WhatsAppChannelConfigEntity } from "../../domain/ports/whatsapp-config-repository.port.js";
import { operatorConnection, type OperatorConnection, type OperatorRequestScope } from "../../domain/services/whatsapp-operator-connection.js";
import { classifyOperatorSubmission, type OperatorDeliveryCandidate } from "../../domain/services/whatsapp-operator-delivery.js";
import { WHATSAPP_RESUME_REQUESTED, currentResumeCase, ownsResumeDispatch, parseResumeDispatch,
  type ResumeOutboxRow, type WhatsAppResumeAuthority, type WhatsAppResumeDispatch } from "../../domain/services/whatsapp-resume-command.js";
import { whatsappE164 } from "../../domain/services/whatsapp-phone.js";
import { decodeWhatsAppCredentials } from "../../infrastructure/repositories/whatsapp-credential-codec.js";
import { PrismaWhatsAppHandoffRepository, type LockedWhatsAppConversation } from "../../infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { loadResumeMessageWithin, readStoredResumeAuthority, saveResumeDeliveryWithin, type StoredResumeCommand } from "./whatsapp-resume-message-state.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type ReadyAuthority = WhatsAppResumeAuthority & { identityStatus: "available"; accountId: string; recipient: string };
const ready = (a: WhatsAppResumeAuthority): a is ReadyAuthority => a.identityStatus === "available" && typeof a.accountId === "string" && typeof a.recipient === "string";
const scopeOf = (a: WhatsAppResumeAuthority) => ({ merchantId: a.merchantId, configId: a.configId, whatsappSessionId: a.whatsappSessionId });
interface Facts { member: MerchantUser | null; connection: OperatorConnection; providerAccountId?: string; sender?: string }
interface Attempt { proof: Readonly<WhatsAppResumeDispatch>; authority: Readonly<ReadyAuthority>; token: string; requestScope: OperatorRequestScope; text: string; providerAccountId?: string; sender?: string }
interface Tracker { invoked: boolean; commitUnknown: boolean; denied?: string }
class ResumeNotStarted extends Error { constructor(readonly code: string) { super(code); } }

/** Exclusive durable human_resume consumer. It never mints an AI inbox turn
 * or accepts support_message authority. An unavailable original is terminal. */
@Injectable()
export class WhatsAppResumeOutboxConsumer implements OnModuleInit {
  private readonly active = new Map<string, Promise<void>>();
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly bindings: PrismaWhatsAppHandoffRepository, private readonly tenant: TenantContextService,
    @Inject(WHATSAPP_SENDER_PORT) private readonly sender: WhatsAppSenderPort,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus) {}
  onModuleInit() { this.events.subscribe(WHATSAPP_RESUME_REQUESTED, event => this.handle(event), "whatsapp-human-resume-v1"); }
  handle(event: DomainEvent): Promise<void> {
    const proof = parseResumeDispatch(event); if (!proof) return Promise.reject(Error("resume_dispatch_proof_required"));
    const key = JSON.stringify([proof.eventId, proof.leaseToken]), running = this.active.get(key); if (running) return running;
    const pending = this.execute(proof).finally(() => this.active.delete(key)); this.active.set(key, pending); return pending;
  }
  private async execute(proof: Readonly<WhatsAppResumeDispatch>) {
    const context = this.tenant.get(); if (context && context.merchantId !== proof.merchantId) throw Error("resume_dispatch_scope_mismatch");
    const event = await this.prisma.outboxMessage.findFirst({ where: { eventId: proof.eventId, merchantId: proof.merchantId } });
    if (!ownsResumeDispatch(proof, event, await this.clock(this.prisma))) throw Error("resume_dispatch_lease_lost");
    const row = await this.prisma.whatsAppDelivery.findFirst({ where: { id: proof.deliveryId, merchantId: proof.merchantId } });
    const authority = row && readStoredResumeAuthority(row, proof); if (!authority) throw Error("resume_original_command_required");
    // No preparation, config refresh or SDK call can upgrade this old intent.
    if (!ready(authority)) {
      await this.prisma.$transaction(async tx => {
        await lockSupportResource(tx, "support:" + proof.ticketId);
        await loadResumeMessageWithin(tx, proof, authority);
        if (!ownsResumeDispatch(proof, await this.lockEvent(tx, proof), await this.clock(tx))) throw Error("resume_dispatch_lease_lost");
      });
      return;
    }
    await withoutWhatsAppExecutionForVerifiedOperation(() => this.tenant.run({ merchantId: proof.merchantId,
      userId: "whatsapp-resume-outbox", role: "system" }, () => this.process(proof, authority)));
  }
  private async process(proof: Readonly<WhatsAppResumeDispatch>, authority: Readonly<ReadyAuthority>) {
    let attempt: Attempt | undefined;
    try { attempt = await this.prepare(proof, authority); }
    catch (error) {
      if (["whatsapp_handoff_session_not_found", "whatsapp_handoff_scope_not_found", "whatsapp_handoff_config_changed"].includes(String(error instanceof Error ? error.message : ""))) {
        await this.failQueued(proof, authority, "channel_context_changed"); return;
      }
      throw error;
    }
    if (!attempt) return;
    const tracker: Tracker = { invoked: false, commitUnknown: false };
    const frame: WhatsAppSubmission = { requestScope: attempt.requestScope,
      startRequest: <T>(scope: Extract<WhatsAppRequestScope, { kind: "whatsapp" }>, start: () => Promise<T>) => this.start(attempt!, tracker, scope, start) };
    let result: WhatsAppSendResult;
    try { result = await withWhatsAppSubmission(frame, () => this.sender.sendText(Object.freeze({ provider: authority.provider,
      deviceId: authority.deviceId, toNumber: authority.recipient, text: attempt!.text, correlationId: proof.deliveryId }))); }
    catch { result = { status: "unknown", messageId: "" }; }
    const candidate: OperatorDeliveryCandidate = tracker.commitUnknown ? { status: "unknown", providerMessageId: null, errorCode: "submission_unknown" }
      : tracker.denied ? { status: "failed", providerMessageId: null, errorCode: tracker.denied }
      : classifyOperatorSubmission(tracker.invoked ? "started" : result.status === "failed" ? "not_started" : "unknown", result);
    await this.finish(attempt, candidate, tracker);
  }
  private async prepare(proof: Readonly<WhatsAppResumeDispatch>, authority: Readonly<ReadyAuthority>): Promise<Attempt | undefined> {
    return this.bindings.withReadLock(scopeOf(authority), async (tx, locked) => {
      await lockSupportResource(tx, "support:" + proof.ticketId);
      const facts = await this.facts(tx, authority), command = await loadResumeMessageWithin(tx, proof, authority);
      const event = await this.lockEvent(tx, proof), now = await this.clock(tx);
      if (!ownsResumeDispatch(proof, event, now)) throw Error("resume_dispatch_lease_lost");
      if (command.projection.status !== "queued") return;
      if (command.row.state === "preparing" || command.row.state === "started") {
        await saveResumeDeliveryWithin(tx, command, { status: "unknown", providerMessageId: null, errorCode: "submission_unknown" }); return;
      }
      if (command.row.state !== "queued" || command.row.processingToken !== "not_started") throw Error("resume_attempt_state_invalid");
      const denied = this.denied(command, locked, facts) ?? (!this.validInbound(await this.latestInbound(tx, authority), authority, now) ? "service_window_unavailable" : undefined);
      if (denied) { await saveResumeDeliveryWithin(tx, command, { status: "failed", providerMessageId: null, errorCode: denied }); return; }
      if (facts.connection.kind !== "ready") throw Error("resume_connection_required");
      const token = randomUUID(), requestScope = Object.freeze({ ...facts.connection.scope, messageId: proof.deliveryId });
      await saveResumeDeliveryWithin(tx, command, { status: "queued", providerMessageId: null }, { internalState: "preparing", processingToken: token,
        privatePatch: { submission: { attemptToken: token, outboxEventId: proof.eventId, outboxLeaseToken: proof.leaseToken,
          credentialDigest: requestScope.credentialDigest, ...(facts.providerAccountId ? { providerAccountId: facts.providerAccountId } : {}),
          ...(facts.sender ? { sender: facts.sender } : {}), phase: "preparing" } } });
      return { proof, authority, token, requestScope, text: command.message.content, providerAccountId: facts.providerAccountId, sender: facts.sender };
    });
  }
  private async start<T>(attempt: Attempt, tracker: Tracker, actual: Extract<WhatsAppRequestScope, { kind: "whatsapp" }>, start: () => Promise<T>): Promise<T> {
    if (tracker.invoked || canonicalJson(actual) !== canonicalJson(attempt.requestScope) || currentWhatsAppSubmissionScope() !== attempt.requestScope) {
      tracker.denied = "channel_context_changed"; throw new ResumeNotStarted(tracker.denied);
    }
    let pending: Promise<T> | undefined;
    try {
      await this.bindings.withReadLock(scopeOf(attempt.authority), async (tx, locked) => {
        await lockSupportResource(tx, "support:" + attempt.proof.ticketId);
        const facts = await this.facts(tx, attempt.authority), command = await loadResumeMessageWithin(tx, attempt.proof, attempt.authority);
        const event = await this.lockEvent(tx, attempt.proof);
        if (command.row.state !== "preparing" || command.row.processingToken !== attempt.token || !this.ownsAttempt(command, attempt))
          throw new ResumeNotStarted("conversation_changed");
        const denied = this.denied(command, locked, facts); if (denied) throw new ResumeNotStarted(denied);
        if (facts.connection.kind !== "ready" || canonicalJson({ ...facts.connection.scope, messageId: attempt.proof.deliveryId }) !== canonicalJson(attempt.requestScope))
          throw new ResumeNotStarted("channel_context_changed");
        await saveResumeDeliveryWithin(tx, command, { status: "queued", providerMessageId: null }, { internalState: "started",
          privatePatch: { submission: { ...this.attemptJson(attempt), phase: "started" } } });
        // Fresh clock follows every row wait/write. The verified callback starts
        // synchronously while locks remain; provider IO is awaited after commit.
        const inbound = await this.latestInbound(tx, attempt.authority), now = await this.clock(tx);
        if (!ownsResumeDispatch(attempt.proof, event, now)) throw new ResumeNotStarted("dispatch_lease_lost");
        if (!this.validInbound(inbound, attempt.authority, now)) throw new ResumeNotStarted("service_window_unavailable");
        tracker.invoked = true; pending = start(); pending.catch(() => {});
      });
    } catch (error) {
      if (tracker.invoked) {
        tracker.commitUnknown = true;
        if (pending) { const response = await pending.catch(() => undefined); if (response instanceof Response) await response.body?.cancel().catch(() => undefined); }
      } else if (error instanceof ResumeNotStarted) tracker.denied = error.code;
      throw error;
    }
    if (!pending) throw new ResumeNotStarted("submission_not_started"); return pending;
  }
  private async finish(attempt: Attempt, candidate: OperatorDeliveryCandidate, tracker: Tracker) {
    await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, "support:" + attempt.proof.ticketId);
      const command = await loadResumeMessageWithin(tx, attempt.proof, attempt.authority);
      if (command.row.processingToken !== attempt.token || !this.ownsAttempt(command, attempt)) return;
      await saveResumeDeliveryWithin(tx, command, candidate, { privatePatch: { submission: { ...this.attemptJson(attempt),
        phase: candidate.status, requestInvoked: tracker.invoked, commitUnknown: tracker.commitUnknown } } });
    });
  }
  private async failQueued(proof: Readonly<WhatsAppResumeDispatch>, authority: Readonly<ReadyAuthority>, code: string) {
    await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, "support:" + proof.ticketId); const command = await loadResumeMessageWithin(tx, proof, authority);
      const event = await this.lockEvent(tx, proof); if (!ownsResumeDispatch(proof, event, await this.clock(tx))) throw Error("resume_dispatch_lease_lost");
      if (command.row.state === "queued" && command.row.processingToken === "not_started")
        await saveResumeDeliveryWithin(tx, command, { status: "failed", providerMessageId: null, errorCode: code });
    });
  }
  private attemptJson(attempt: Attempt) { return { attemptToken: attempt.token, outboxEventId: attempt.proof.eventId,
    outboxLeaseToken: attempt.proof.leaseToken, credentialDigest: attempt.requestScope.credentialDigest,
    ...(attempt.providerAccountId ? { providerAccountId: attempt.providerAccountId } : {}), ...(attempt.sender ? { sender: attempt.sender } : {}) }; }
  private ownsAttempt(command: StoredResumeCommand, attempt: Attempt) {
    const value = object(command.response.submission); return value.attemptToken === attempt.token && value.outboxEventId === attempt.proof.eventId
      && value.outboxLeaseToken === attempt.proof.leaseToken && value.credentialDigest === attempt.requestScope.credentialDigest;
  }
  private async lockEvent(tx: Prisma.TransactionClient, proof: WhatsAppResumeDispatch): Promise<ResumeOutboxRow | null> {
    await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE event_id=${proof.eventId} AND merchant_id=${proof.merchantId} FOR UPDATE`;
    return tx.outboxMessage.findFirst({ where: { eventId: proof.eventId, merchantId: proof.merchantId } });
  }
  private async clock(tx: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<Date> {
    const [value] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!value || !(value.now instanceof Date) || !Number.isFinite(value.now.getTime())) throw Error("resume_sql_clock_unavailable"); return value.now;
  }
  private async facts(tx: Prisma.TransactionClient, authority: ReadyAuthority): Promise<Facts> {
    await tx.$queryRaw`SELECT id FROM whatsapp_channel_configs WHERE id=${authority.configId} AND merchant_id=${authority.merchantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM merchant_users WHERE id=${authority.operatorId} AND merchant_id=${authority.merchantId} FOR SHARE`;
    const [raw, member] = await Promise.all([tx.whatsAppChannelConfig.findFirst({ where: { id: authority.configId, merchantId: authority.merchantId } }),
      tx.merchantUser.findFirst({ where: { id: authority.operatorId, merchantId: authority.merchantId } })]);
    if (!raw) return { member, connection: { kind: "unavailable", code: "channel_identity_unavailable" } };
    let credentials: Record<string, unknown>; try { credentials = decodeWhatsAppCredentials(object(raw.credentials)); }
    catch { return { member, connection: { kind: "unavailable", code: "channel_identity_unavailable" } }; }
    const config: WhatsAppChannelConfigEntity = { ...raw, credentials, whatsappNumber: raw.whatsappNumber ?? undefined,
      deviceId: raw.deviceId ?? undefined, phoneNumber: raw.phoneNumber ?? undefined, webhookSecret: raw.webhookSecret ?? undefined, connectedAt: raw.connectedAt ?? undefined };
    const connection = operatorConnection(config, authority), providerAccountId = config.provider === "META_CLOUD" ? credentials.phoneNumberId : credentials.accountSid;
    const sender = config.provider === "TWILIO" && typeof credentials.senderId === "string" ? whatsappE164(credentials.senderId.replace(/^whatsapp:/, "")) : undefined;
    return { member, connection, ...(connection.kind === "ready" && typeof providerAccountId === "string" ? { providerAccountId, ...(sender ? { sender } : {}) } : {}) };
  }
  private denied(command: StoredResumeCommand, locked: LockedWhatsAppConversation, facts: Facts) {
    if (!currentResumeCase(command.authority, locked.binding, command.ticket, locked.session)) return "conversation_changed";
    if (!facts.member || facts.member.disabledAt !== null || !["owner", "admin", "staff"].includes(facts.member.role.toLowerCase())) return "operator_unavailable";
    return facts.connection.kind === "unavailable" ? facts.connection.code : undefined;
  }
  private latestInbound(tx: Prisma.TransactionClient, authority: ReadyAuthority) {
    const streamKey = createHash("sha256").update(JSON.stringify([authority.merchantId, authority.configId, "message", authority.recipient.replace(/\D/g, "")])).digest("hex");
    return tx.whatsAppWebhookInbox.findFirst({ where: { merchantId: authority.merchantId, configId: authority.configId, deviceId: authority.deviceId,
      kind: "message", streamKey }, orderBy: { createdAt: "desc" } });
  }
  private validInbound(inbound: Awaited<ReturnType<WhatsAppResumeOutboxConsumer["latestInbound"]>>, authority: ReadyAuthority, now: Date) {
    if (!inbound) return false; const payload = object(inbound.payload), timestamp = payload.timestamp;
    return payload.ignored !== true && payload.merchantId === authority.merchantId && payload.deviceId === authority.deviceId && payload.provider === authority.provider
      && typeof payload.fromNumber === "string" && whatsappE164(payload.fromNumber) === authority.recipient && typeof timestamp === "number"
      && Number.isSafeInteger(timestamp) && timestamp >= 0 && now.getTime() - Math.min(timestamp, inbound.createdAt.getTime()) < WINDOW_MS;
  }
}
