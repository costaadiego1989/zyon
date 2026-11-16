import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { WhatsAppAiSuppressedError, currentWhatsAppExecution, withWhatsAppExecution, withoutWhatsAppExecutionForVerifiedOperation, type WhatsAppRequestScope } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
export { WhatsAppAiSuppressedError } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { captureAiAuthority, createOwnContextReceipt, matchesAiAuthority, readAiAuthority,
  type AiConversationSnapshot, type OriginalAiAuthority } from "../../domain/services/whatsapp-ai-authority.js";
import { WhatsAppTurnContext, type VerifiedWhatsAppTurn } from "../../domain/services/whatsapp-turn-context.js";
import { whatsappE164 } from "../../domain/services/whatsapp-phone.js";
import { twilioAuthorityAccountId } from "../../domain/services/connected-twilio-credentials.js";
import { decodeWhatsAppCredentials } from "../../infrastructure/repositories/whatsapp-credential-codec.js";
import { PrismaWhatsAppHandoffRepository, type LockedWhatsAppConversation } from "../../infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { loadWhatsAppInboxTurnWithin, saveWhatsAppResponseWithin } from "../../infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.js";
import type { WhatsAppInboxClaim } from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import type { WhatsAppConversationState } from "../../domain/ui/meta-ui.types.js";
import type { WhatsAppHumanNotice } from "./whatsapp-human-intake.service.js";
import type { IncomingMessageInput } from "../use-cases/handle-incoming-message.use-case.js";
import type { HumanInputReceipt } from "./whatsapp-human-message-router.js";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export class WhatsAppRequestUncertainError extends Error {
  constructor() { super("whatsapp_send_result_unknown"); }
}

/** Server-owned original-turn admission. The identity lock lives in the
 * transaction which commits the effect, or only through synchronous request
 * initiation. No network response/LLM completion holds that SQL lock. */
@Injectable()
export class WhatsAppAiDispatchFence {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly bindings: PrismaWhatsAppHandoffRepository, private readonly turns: WhatsAppTurnContext) {}

  async run<T>(claim: WhatsAppInboxClaim, work: () => Promise<T>): Promise<T> {
    const turn = this.requireTurn(claim);
    const original = await this.bindings.withReadLock(turn.scope, async (tx, locked) => {
      const row = await this.inbox(tx, claim, locked);
      const previous = record(row.responseState);
      let authority = readAiAuthority(previous.aiAuthority);
      if (!authority) {
        // Legacy/uncertain work cannot adopt the current epoch. Only an empty
        // new inbox creates authority; no handoff binding is created here.
        if (Object.keys(previous).length) throw new WhatsAppAiSuppressedError();
        authority = captureAiAuthority(this.snapshot(locked), claim.id);
        if (!await saveWhatsAppResponseWithin(tx, claim, { phase: "authority", aiAuthority: authority })) throw new Error("whatsapp_inbox_lease_lost");
      }
      await this.checkWithin(tx, claim, authority, locked);
      return authority;
    });
    return this.withOriginal(claim, original, work);
  }

  async originalForSuppression(claim: WhatsAppInboxClaim) {
    const row = await this.prisma.whatsAppWebhookInbox.findFirst({ where: { id: claim.id, merchantId: claim.merchantId,
      configId: claim.configId, deviceId: claim.deviceId, status: "processing", leaseToken: claim.leaseToken } });
    return readAiAuthority(record(row?.responseState).aiAuthority);
  }

  /** The T50 receipt consumes the original intake, including an uncertain
   * notice with no confirmed ticket. It never routes into a newer case. */
  async consumeHandoffReplay(claim: WhatsAppInboxClaim): Promise<boolean> {
    const candidate = await this.prisma.whatsAppWebhookInbox.findFirst({ where: { id: claim.id, merchantId: claim.merchantId,
      configId: claim.configId, deviceId: claim.deviceId, status: "processing", leaseToken: claim.leaseToken } });
    const initial = record(candidate?.responseState), original = readAiAuthority(initial.aiAuthority);
    if (initial.purpose !== "human_handoff") return false;
    const sessionId = original?.whatsappSessionId ?? initial.sessionId;
    if (typeof sessionId !== "string" || !sessionId || original && (original.inboxId !== claim.id
      || original.merchantId !== claim.merchantId || original.configId !== claim.configId || original.deviceId !== claim.deviceId)) return false;
    return this.bindings.withReadLock({ merchantId: claim.merchantId, configId: claim.configId, whatsappSessionId: sessionId }, async (tx, locked) => {
      const row = await this.inbox(tx, claim, locked), saved = record(row.responseState), notice = record(saved.handoff);
      if (saved.purpose !== "human_handoff") return false;
      const messages = await tx.supportTicketMessage.findMany({ where: { senderType: "buyer",
        clientMessageId: "wa_" + createHash("sha256").update(claim.id).digest("hex"),
        ticket: { merchantId: claim.merchantId, source: "whatsapp", sessionId } }, take: 2 });
      if (messages.length > 1) throw new Error("whatsapp_human_receipt_invalid");
      const message = messages[0], meta = record(message?.metadata);
      let receipt: HumanInputReceipt;
      if (message) {
        if (meta.kind !== "whatsapp_intake" || meta.schemaVersion !== 1 || meta.inboxId !== claim.id
          || meta.configId !== claim.configId || meta.whatsappSessionId !== sessionId || typeof meta.epoch !== "number"
          || !Number.isSafeInteger(meta.epoch) || meta.epoch < 1 || notice.confirmed === true && notice.ticketId !== message.ticketId)
          throw new Error("whatsapp_human_receipt_invalid");
        if (notice.confirmed === true && (typeof notice.bindingId !== "string" || !notice.bindingId.trim()
          || notice.bindingId !== locked.binding?.id || notice.epoch !== meta.epoch
          || original && (notice.epoch !== original.epoch + 1 || original.bindingId !== null && notice.bindingId !== original.bindingId))) {
          const { receipt: _unprovenReceipt, ...suppressed } = saved;
          if (!await saveWhatsAppResponseWithin(tx, claim, { ...suppressed, purpose: "ai_suppressed", phase: "complete" }))
            throw new Error("whatsapp_inbox_lease_lost");
          return true;
        }
        receipt = { inboxId: claim.id, sessionId, bindingId: notice.confirmed === true && typeof notice.bindingId === "string" ? notice.bindingId : null,
          ticketId: message.ticketId, epoch: meta.epoch, messageId: message.id };
      } else {
        if (notice.confirmed !== false) return false;
        receipt = { inboxId: claim.id, sessionId, bindingId: null, ticketId: null, epoch: null };
      }
      if (!await saveWhatsAppResponseWithin(tx, claim, { ...saved, purpose: "human_received", phase: "complete", receipt: { ...receipt } }))
        throw new Error("whatsapp_inbox_lease_lost");
      return true;
    });
  }

  /** A live legacy invocation may finish before it captured any outgoing UI.
   * Its terminal inbox result can close only that invocation's own delivery;
   * it is never proof that an uncertain provider request was delivered. */
  async terminalSuppression(claim: WhatsAppInboxClaim) {
    const authority = await this.originalForSuppression(claim);
    if (!authority || authority.inboxId !== claim.id || authority.merchantId !== claim.merchantId
      || authority.configId !== claim.configId || authority.deviceId !== claim.deviceId) return;
    return this.bindings.withReadLock(authority, async (tx, locked) => {
      const row = await this.inbox(tx, claim, locked), saved = record(row.responseState);
      if (saved.phase !== "complete" || canonicalJson(saved.aiAuthority) !== canonicalJson(authority)) return;
      if (saved.purpose === "ai_suppressed") return { authority };
      const raw = record(saved.receipt);
      if (saved.purpose === "human_received" && record(saved.handoff).confirmed === false && raw.inboxId === claim.id
        && raw.sessionId === authority.whatsappSessionId && raw.bindingId === null && raw.ticketId === null && raw.epoch === null)
        return { authority, receipt: { inboxId: claim.id, sessionId: authority.whatsappSessionId, bindingId: null, ticketId: null, epoch: null } as HumanInputReceipt };
      if (saved.purpose !== "human_received" || typeof raw.inboxId !== "string" || typeof raw.sessionId !== "string"
        || typeof raw.ticketId !== "string" || raw.bindingId !== null && typeof raw.bindingId !== "string" || typeof raw.messageId !== "string"
        || typeof raw.epoch !== "number" || !Number.isSafeInteger(raw.epoch)) return;
      const receipt: HumanInputReceipt = { inboxId: raw.inboxId, sessionId: raw.sessionId, ticketId: raw.ticketId,
        bindingId: raw.bindingId, messageId: raw.messageId, epoch: raw.epoch };
      await this.verifyHumanReceipt(tx, claim, authority.whatsappSessionId, receipt);
      return { authority, receipt };
    });
  }

  /** A deferred turn can be refused before routing has reconstructed the
   * live turn context. Its original persisted capability remains the scope;
   * unversioned legacy work is discarded without minting an AI0 capability. */
  async suppressBeforeRouting(claim: WhatsAppInboxClaim): Promise<void> {
    const authority = await this.originalForSuppression(claim);
    if (authority) {
      if (authority.inboxId !== claim.id || authority.merchantId !== claim.merchantId || authority.configId !== claim.configId
        || authority.deviceId !== claim.deviceId) throw new WhatsAppAiSuppressedError();
      return this.turns.run({ scope: authority, inboxId: claim.id, leaseToken: claim.leaseToken,
        conversationId: authority.conversationId, message: "", origin: "text" }, () => this.suppress(claim));
    }
    await this.prisma.$transaction(async tx => {
      const row = await loadWhatsAppInboxTurnWithin(tx, claim);
      if (!row) throw new Error("whatsapp_inbox_lease_lost");
      const previous = record(row.responseState);
      if (previous.purpose === "human_received" && previous.phase === "complete") return;
      if (!await saveWhatsAppResponseWithin(tx, claim, { ...previous, purpose: "ai_suppressed", phase: "complete" }))
        throw new Error("whatsapp_inbox_lease_lost");
    });
  }

  private async verifyHumanReceipt(tx: Prisma.TransactionClient, claim: WhatsAppInboxClaim,
    whatsappSessionId: string, receipt: HumanInputReceipt): Promise<void> {
    const message = receipt.messageId ? await tx.supportTicketMessage.findFirst({ where: { id: receipt.messageId, ticketId: receipt.ticketId ?? "",
      ticket: { merchantId: claim.merchantId, source: "whatsapp", sessionId: whatsappSessionId } } }) : null;
    const metadata = record(message?.metadata);
    if (receipt.inboxId !== claim.id || receipt.sessionId !== whatsappSessionId || metadata.inboxId !== claim.id
      || !["whatsapp_incoming", "whatsapp_intake"].includes(String(metadata.kind)) || metadata.schemaVersion !== 1
      || metadata.kind === "whatsapp_incoming" && metadata.bindingId !== receipt.bindingId
      || metadata.configId !== claim.configId || metadata.whatsappSessionId !== whatsappSessionId || metadata.epoch !== receipt.epoch)
      throw new Error("whatsapp_human_receipt_invalid");
  }

  async suppress(claim: WhatsAppInboxClaim, receipt?: HumanInputReceipt): Promise<void> {
    const turn = this.requireTurn(claim);
    await this.bindings.withReadLock(turn.scope, async (tx, locked) => {
      const row = await this.inbox(tx, claim, locked);
      const previous = record(row.responseState);
      if (previous.purpose === "human_received") return;
      if (receipt) {
        await this.verifyHumanReceipt(tx, claim, turn.scope.whatsappSessionId, receipt);
      }
      if (!await saveWhatsAppResponseWithin(tx, claim, { ...previous, purpose: receipt ? "human_received" : "ai_suppressed", phase: "complete",
        ...(receipt ? { receipt: { ...receipt } } : {}) })) throw new Error("whatsapp_inbox_lease_lost");
    });
  }

  /** Re-route only into the still-open case which first took this original AI
   * epoch over. A close/new case or renewal must not adopt old delayed input. */
  async withSuppressedInput<T>(claim: WhatsAppInboxClaim, rawAuthority: unknown,
    work: (input: IncomingMessageInput, expected: { bindingId: string; ticketId: string; epoch: number }) => Promise<T>): Promise<T | undefined> {
    const original = readAiAuthority(rawAuthority);
    if (!original || original.inboxId !== claim.id || original.merchantId !== claim.merchantId
      || original.configId !== claim.configId || original.deviceId !== claim.deviceId) return;
    const eligible = await this.bindings.withReadLock(original, async (tx, locked) => {
      const row = await this.inbox(tx, claim, locked), saved = record(row.responseState), binding = locked.binding;
      const notice = record(saved.handoff), consumed = record(saved.receipt);
      if (saved.purpose === "human_received" && consumed.inboxId === claim.id && consumed.sessionId === original.whatsappSessionId
        && consumed.bindingId === null && consumed.ticketId === null && consumed.epoch === null) return;
      if (!binding || binding.mode === "ai" || !binding.ticketId || original.bindingId !== null && original.bindingId !== binding.id
        || canonicalJson(readAiAuthority(saved.aiAuthority)) !== canonicalJson(original)
        || !matchesAiAuthority({ ...this.snapshot(locked), binding: original.bindingId === null ? null
          : { id: original.bindingId, epoch: original.epoch, mode: "ai" } }, original, saved.ownContextReceipt)) return;
      if (notice.confirmed === true && (notice.bindingId !== binding.id || notice.ticketId !== binding.ticketId
        || notice.epoch !== original.epoch + 1)) return;
      const ticket = await tx.supportTicket.findFirst({ where: { id: binding.ticketId, merchantId: original.merchantId,
        sessionId: original.whatsappSessionId, source: "whatsapp", status: { in: ["open", "in_progress"] }, mergedIntoId: null } });
      const initial = ticket && await tx.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, senderType: "buyer",
        AND: [{ metadata: { path: ["kind"], equals: "whatsapp_intake" } }, { metadata: { path: ["configId"], equals: original.configId } },
          { metadata: { path: ["whatsappSessionId"], equals: original.whatsappSessionId } }, { metadata: { path: ["epoch"], equals: original.epoch + 1 } }] } });
      return initial ? { input: row.payload as unknown as IncomingMessageInput, expected: {
        bindingId: binding.id, ticketId: binding.ticketId, epoch: binding.epoch } } : undefined;
    });
    if (!eligible) return;
    const { input, expected } = eligible;
    const previous = this.turns.current();
    const speech = previous?.inboxId === claim.id && previous.origin === "voice" && previous.scope.whatsappSessionId === original.whatsappSessionId;
    return this.turns.run({ scope: original, inboxId: claim.id, leaseToken: claim.leaseToken, conversationId: original.conversationId,
      message: speech ? previous.message : input.body, origin: speech ? "voice" : input.interactiveId ? "button" : "text" }, () => work(input, expected));
  }

  /** Legacy deferred sending restores the persisted token; it never captures
   * a new epoch for a response generated by a different invocation. */
  restore<T>(claim: WhatsAppInboxClaim, authority: unknown, work: () => Promise<T>, notice?: WhatsAppHumanNotice): Promise<T> {
    const original = readAiAuthority(authority);
    if (!original || original.inboxId !== claim.id || original.merchantId !== claim.merchantId
      || original.configId !== claim.configId || original.deviceId !== claim.deviceId) throw new WhatsAppAiSuppressedError();
    return notice?.confirmed ? this.notice(claim, original, notice, work) : this.withOriginal(claim, original, work);
  }

  private withOriginal<T>(claim: WhatsAppInboxClaim, original: Readonly<OriginalAiAuthority>, work: () => Promise<T>): Promise<T> {
    const active = currentWhatsAppExecution();
    if (active) {
      if (active.notice || canonicalJson(active.authority) !== canonicalJson(original)) throw new WhatsAppAiSuppressedError();
      return work();
    }
    const admit = async (tx: Prisma.TransactionClient, merchantId: string) => {
      if (merchantId !== original.merchantId) throw new WhatsAppAiSuppressedError();
      const row = await this.checkWithin(tx, claim, original);
      if (!await saveWhatsAppResponseWithin(tx, claim, { ...record(row.responseState),
        aiEffectReceipt: { version: 1, inboxId: claim.id, authority: original } })) throw new Error("whatsapp_inbox_lease_lost");
    };
    return withWhatsAppExecution({ authority: original,
      admitEffect: admit, admitDelivery: admit,
      startRequest: (scope, start) => this.start(claim, original, scope, start),
    }, work);
  }

  /** An initial handoff acknowledgement is a narrowly authorized server
   * notice, not a new AI generation or a free operational-origin flag. */
  async notice<T>(claim: WhatsAppInboxClaim, original: OriginalAiAuthority, notice: WhatsAppHumanNotice, work: () => Promise<T>): Promise<T> {
    const restored = readAiAuthority(original);
    if (!restored || restored.inboxId !== claim.id) throw new WhatsAppAiSuppressedError();
    original = restored;
    notice = Object.freeze({ ...notice });
    if (!notice.confirmed) return work(); // Remains inside the original AI frame.
    await this.bindings.withReadLock(original, async (tx, locked) => {
      const row = await this.checkNoticeWithin(tx, claim, original, notice, locked, true);
      if (!await saveWhatsAppResponseWithin(tx, claim, { ...record(row.responseState), purpose: "human_handoff", handoff: notice })) throw new Error("whatsapp_inbox_lease_lost");
    });
    const frame = { authority: original, notice: Object.freeze({ ...notice }),
      admitEffect: async () => { throw new WhatsAppAiSuppressedError(); },
      admitDelivery: async (tx: Prisma.TransactionClient, merchantId: string) => {
        if (merchantId !== original.merchantId) throw new WhatsAppAiSuppressedError();
        await this.checkNoticeWithin(tx, claim, original, notice);
      },
      startRequest: <R>(scope: WhatsAppRequestScope, start: () => Promise<R>) => this.start(claim, original, scope, start, notice),
    };
    // This branch has just verified the exact canonical handoff/message proof;
    // it substitutes a notice-only capability, never a generic origin flag.
    return withoutWhatsAppExecutionForVerifiedOperation(() => withWhatsAppExecution(frame, work));
  }

  private async start<T>(claim: WhatsAppInboxClaim, original: OriginalAiAuthority, scope: WhatsAppRequestScope,
    start: () => Promise<T>, notice?: WhatsAppHumanNotice): Promise<T> {
    let started = false;
    let submission: Promise<T> | undefined;
    try {
      const box = await this.bindings.withReadLock(original, async (tx, locked) => {
        this.matchesRequest(original, scope);
        if (notice?.confirmed) {
          await this.checkNoticeWithin(tx, claim, original, notice, locked);
        } else await this.checkWithin(tx, claim, original, locked);
        if (scope.kind === "payment" && scope.intentId) {
          const payment = await tx.paymentIntent.findFirst({ where: { id: scope.intentId, merchantId: original.merchantId, sessionId: scope.sessionId } });
          const creation = record(payment?.creation);
          const input = record(creation.input);
          const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS now`);
          if (!scope.sessionId || !scope.creationLeaseToken || !payment || payment.status !== "pending"
            || payment.sessionId !== locked.session.checkoutSessionId || payment.providerPaymentId
            || creation.state !== "in_flight" || creation.leaseToken !== scope.creationLeaseToken
            || input.merchantId !== original.merchantId || input.sessionId !== scope.sessionId || input.intentId !== scope.intentId
            || typeof creation.leaseUntil !== "string" || !(new Date(creation.leaseUntil).getTime() > clock.now.getTime()))
            throw new WhatsAppAiSuppressedError();
        }
        started = true;
        submission = start();
        // Rejection can happen before SQL commit. Handle it immediately, while
        // preserving the original promise/result for the caller outside SQL.
        void submission.catch(() => undefined);
        return { submission };
      });
      return await box.submission;
    } catch (error) {
      if (started) {
        void submission?.catch(() => undefined);
        // A transaction failure after request start cannot safely be retried.
        throw new WhatsAppRequestUncertainError();
      }
      throw error;
    }
  }

  private async checkNoticeWithin(tx: Prisma.TransactionClient, claim: WhatsAppInboxClaim, original: OriginalAiAuthority,
    notice: WhatsAppHumanNotice, current?: LockedWhatsAppConversation, initial = false) {
    const locked = current ?? await this.bindings.readLocked(tx, original);
    const row = await this.inbox(tx, claim, locked);
    const saved = record(row.responseState), persisted = record(saved.handoff), binding = locked.binding;
    if (!notice.confirmed || !notice.ticketId || !binding || binding.mode !== "waiting_human" || binding.id !== notice.bindingId
      || binding.epoch !== notice.epoch || binding.ticketId !== notice.ticketId
      || canonicalJson(readAiAuthority(saved.aiAuthority)) !== canonicalJson(original)
      || !matchesAiAuthority({ ...this.snapshot(locked), binding: original.bindingId === null ? null
        : { id: original.bindingId, epoch: original.epoch, mode: "ai" } }, original)
      || !initial && (saved.purpose !== "human_handoff" || persisted.ticketId !== notice.ticketId
        || persisted.bindingId !== notice.bindingId || persisted.epoch !== notice.epoch)) throw new WhatsAppAiSuppressedError();
    const ticket = await tx.supportTicket.findFirst({ where: { id: notice.ticketId, merchantId: original.merchantId,
      sessionId: original.whatsappSessionId, source: "whatsapp", status: "open", mergedIntoId: null } });
    const message = await tx.supportTicketMessage.findFirst({ where: { ticketId: notice.ticketId, senderType: "buyer",
      clientMessageId: "wa_" + createHash("sha256").update(claim.id).digest("hex") } });
    const metadata = record(message?.metadata);
    if (!ticket || metadata.kind !== "whatsapp_intake" || metadata.schemaVersion !== 1 || metadata.inboxId !== claim.id || metadata.configId !== original.configId
      || metadata.whatsappSessionId !== original.whatsappSessionId || metadata.epoch !== notice.epoch) throw new WhatsAppAiSuppressedError();
    return row;
  }

  /** Session update + its own-context receipt commit together. A failed CAS
   * cannot manufacture permission by setting sessionApplied in memory. */
  async applyPrepared(claim: WhatsAppInboxClaim, state: WhatsAppConversationState,
    response: Record<string, unknown>): Promise<void> {
    const authority = readAiAuthority(currentWhatsAppExecution()?.authority);
    if (!authority) throw new WhatsAppAiSuppressedError();
    if (state.revision !== claim.id || response.sessionId !== undefined && response.sessionId !== authority.whatsappSessionId)
      throw new WhatsAppAiSuppressedError();
    await this.bindings.withReadLock(authority, async (tx, locked) => {
      const row = await this.checkWithin(tx, claim, authority, locked);
      const previous = record(row.responseState);
      if (previous.ownContextReceipt) {
        // Only this exact prepared state may reuse its persisted application.
        if (canonicalJson(previous.state) !== canonicalJson(state)) throw new WhatsAppAiSuppressedError();
        return;
      }
      const current = record(locked.session.conversationState);
      if ((current.revision ?? "") !== authority.revision) throw new WhatsAppAiSuppressedError();
      const updated = await tx.whatsAppSession.update({ where: { id: authority.whatsappSessionId }, data: {
        conversationState: state as unknown as Prisma.InputJsonValue,
        ...(state.checkoutSessionId ? { checkoutSessionId: state.checkoutSessionId } : {}), lastActivityAt: new Date(),
      } });
      const target = this.snapshot({ ...locked, session: updated });
      const receipt = createOwnContextReceipt(authority, { checkoutSessionId: target.checkoutSessionId,
        conversationId: target.conversationId, revision: target.revision });
      if (!await saveWhatsAppResponseWithin(tx, claim, { ...previous, ...response, aiAuthority: authority,
        ownContextReceipt: receipt, sessionApplied: true })) throw new Error("whatsapp_inbox_lease_lost");
    });
  }

  private async checkWithin(tx: Prisma.TransactionClient, claim: WhatsAppInboxClaim, authority: OriginalAiAuthority,
    current?: LockedWhatsAppConversation) {
    const locked = current ?? await this.bindings.readLocked(tx, authority);
    const row = await this.inbox(tx, claim, locked);
    const persisted = record(row.responseState), restored = readAiAuthority(persisted.aiAuthority);
    if (!restored || canonicalJson(restored) !== canonicalJson(authority)
      || !matchesAiAuthority(this.snapshot(locked), authority, persisted.ownContextReceipt)) throw new WhatsAppAiSuppressedError();
    // Some legacy channels have no conversation revision. An actual later
    // applied turn, unlike a merely received/pending input, supersedes them.
    const newer = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM whatsapp_webhook_inbox WHERE merchant_id=${authority.merchantId} AND config_id=${authority.configId}
        AND stream_key=${row.streamKey} AND kind='message' AND (created_at,id)>(${row.createdAt},${row.id})
        AND (response_state ? 'aiEffectReceipt' OR response_state ? 'ownContextReceipt') LIMIT 1
    `);
    if (newer.length) throw new WhatsAppAiSuppressedError();
    return row;
  }

  private async inbox(tx: Prisma.TransactionClient, claim: WhatsAppInboxClaim, current: LockedWhatsAppConversation) {
    const row = await loadWhatsAppInboxTurnWithin(tx, claim);
    const payload = record(row?.payload);
    if (!row || claim.kind !== "message" || claim.merchantId !== current.session.merchantId || claim.configId !== current.config.id
      || claim.deviceId !== current.session.deviceId || payload.ignored === true || payload.merchantId !== claim.merchantId
      || payload.deviceId !== claim.deviceId || typeof payload.fromNumber !== "string"
      || whatsappE164(payload.fromNumber) !== whatsappE164(current.session.buyerPhone)) throw new Error("whatsapp_inbox_lease_lost");
    return row;
  }

  private snapshot({ session, config, binding }: LockedWhatsAppConversation): AiConversationSnapshot {
    const state = record(session.conversationState), credentials = record(config.credentials);
    const account = config.provider === "META_CLOUD" ? credentials.phoneNumberId : config.provider === "TWILIO"
      ? twilioAuthorityAccountId({ ...config, credentials: decodeWhatsAppCredentials(credentials) }) : config.deviceId;
    if (!config.enabled || config.status !== "ACTIVE" || session.status !== "active" || typeof account !== "string" || !account.trim()) throw new WhatsAppAiSuppressedError();
    return { merchantId: session.merchantId, configId: config.id, whatsappSessionId: session.id, deviceId: session.deviceId,
      buyerPhone: whatsappE164(session.buyerPhone) ?? "", provider: config.provider, accountId: account,
      checkoutSessionId: session.checkoutSessionId, conversationId: typeof state.conversationId === "string" ? state.conversationId : session.checkoutSessionId ?? "",
      revision: typeof state.revision === "string" ? state.revision : "", binding };
  }

  private matchesRequest(original: OriginalAiAuthority, scope: WhatsAppRequestScope): void {
    if (scope.merchantId !== original.merchantId || scope.kind === "whatsapp" && (scope.configId !== original.configId
      || scope.deviceId !== original.deviceId || scope.provider !== original.provider || scope.accountId !== original.accountId
      || scope.recipient !== undefined && whatsappE164(scope.recipient) !== original.buyerPhone)) throw new WhatsAppAiSuppressedError();
  }

  private requireTurn(claim: WhatsAppInboxClaim): Readonly<VerifiedWhatsAppTurn> {
    const turn = this.turns.current();
    if (!turn || turn.inboxId !== claim.id || turn.leaseToken !== claim.leaseToken || turn.scope.configId !== claim.configId
      || turn.scope.merchantId !== claim.merchantId) throw new Error("whatsapp_turn_context_required");
    return turn;
  }
}
