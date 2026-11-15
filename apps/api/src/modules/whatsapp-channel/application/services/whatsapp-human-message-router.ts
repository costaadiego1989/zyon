import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { HandoffState } from "../../domain/services/whatsapp-handoff-state.js";
import { WhatsAppTurnContext, type VerifiedWhatsAppTurn } from "../../domain/services/whatsapp-turn-context.js";
import { whatsappE164 } from "../../domain/services/whatsapp-phone.js";
import { PrismaWhatsAppHandoffRepository } from "../../infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { WHATSAPP_WEBHOOK_INBOX, type WhatsAppWebhookInbox } from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import { lockSupportResource, persistSupportMessage } from "../../../support/application/support-persistence.js";
import { WHATSAPP_HANDOFF_ACK } from "../../../support/application/whatsapp-support-intake.js";
import { WhatsAppDeliveryService } from "./whatsapp-delivery.service.js";
import type { WhatsAppHumanNotice } from "./whatsapp-human-intake.service.js";
import type { IncomingMessageInput } from "../use-cases/handle-incoming-message.use-case.js";

export interface HumanInputReceipt {
  inboxId: string; sessionId: string; bindingId: string | null; ticketId: string | null; epoch: number | null; messageId?: string;
}
type HumanRoute = { kind: "received"; receipt: HumanInputReceipt } | { kind: "notice"; notice: WhatsAppHumanNotice };
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** A durable input remains consumed after the conversation returns to AI. An
 * old initial acknowledgement may resume only in the epoch that created it. */
export function classifyHumanReplay(binding: HandoffState, turn: Pick<VerifiedWhatsAppTurn, "scope" | "inboxId">,
  previous: { id: string; ticketId: string; metadata: unknown } | null): HumanRoute | undefined {
  if (!previous) return;
  const meta = record(previous.metadata);
  if (binding.merchantId !== turn.scope.merchantId || binding.configId !== turn.scope.configId || binding.whatsappSessionId !== turn.scope.whatsappSessionId
    || !meta || !["whatsapp_incoming", "whatsapp_intake"].includes(String(meta.kind)) || meta.schemaVersion !== 1
    || meta.configId !== turn.scope.configId || meta.whatsappSessionId !== turn.scope.whatsappSessionId || meta.inboxId !== turn.inboxId
    || !Number.isSafeInteger(meta.epoch) || Number(meta.epoch) < 0
    || (meta.kind === "whatsapp_incoming" && meta.bindingId !== binding.id)) throw new Error("whatsapp_human_receipt_invalid");
  if (meta.kind === "whatsapp_intake" && binding.mode !== "ai" && binding.ticketId === previous.ticketId && binding.epoch === meta.epoch) {
    return { kind: "notice", notice: { confirmed: true, reply: WHATSAPP_HANDOFF_ACK, ticketId: previous.ticketId, bindingId: binding.id, epoch: binding.epoch } };
  }
  return { kind: "received", receipt: { inboxId: turn.inboxId, sessionId: turn.scope.whatsappSessionId,
    bindingId: binding.id, ticketId: previous.ticketId, epoch: Number(meta.epoch), messageId: previous.id } };
}

@Injectable()
export class WhatsAppHumanMessageRouter {
  constructor(private readonly bindings: PrismaWhatsAppHandoffRepository, private readonly context: WhatsAppTurnContext,
    private readonly delivery: WhatsAppDeliveryService,
    @Inject(WHATSAPP_WEBHOOK_INBOX) private readonly inbox: WhatsAppWebhookInbox) {}

  async route(input: IncomingMessageInput): Promise<HumanRoute | undefined> {
    const turn = this.context.current();
    if (!turn) throw new Error("whatsapp_turn_context_required");
    const claim = input.inboxClaim ?? this.delivery.currentClaim();
    if (!claim || claim.id !== turn.inboxId || claim.leaseToken !== turn.leaseToken) throw new Error("whatsapp_human_claim_invalid");
    const saved = record(claim.responseState);
    // Ordinary AI conversations retain their existing behavior. T51 separately
    // fences the generation/effects against a takeover after this read.
    const existing = await this.bindings.get(turn.scope);
    if (!existing && saved?.purpose !== "human_handoff") return;
    const result = await this.bindings.withLocked(turn.scope, async (tx, current): Promise<HumanRoute | undefined> => {
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS now`);
      const session = await tx.whatsAppSession.findFirst({ where: { id: turn.scope.whatsappSessionId, merchantId: turn.scope.merchantId } });
      const row = await tx.whatsAppWebhookInbox.findFirst({ where: { id: turn.inboxId, merchantId: turn.scope.merchantId,
        configId: turn.scope.configId, kind: "message", status: "processing", leaseToken: turn.leaseToken, leaseExpiresAt: { gt: clock.now } } });
      const payload = record(row?.payload);
      if (!session || !row || !payload || payload.ignored === true || payload.merchantId !== turn.scope.merchantId
        || payload.deviceId !== session.deviceId || row.deviceId !== session.deviceId || typeof payload.fromNumber !== "string"
        || whatsappE164(payload.fromNumber) !== whatsappE164(session.buyerPhone)) throw new NotFoundException("whatsapp_human_inbox_not_found");
      const clientMessageId = "wa_" + createHash("sha256").update(turn.inboxId).digest("hex");
      const previous = await tx.supportTicketMessage.findFirst({ where: { clientMessageId, senderType: "buyer",
        ticket: { merchantId: turn.scope.merchantId, sessionId: session.id, source: "whatsapp" } } });
      const replay = classifyHumanReplay(current, turn, previous);
      if (replay) return replay;
      if (saved?.purpose === "human_handoff") {
        // An uncertain old acknowledgement is terminal here. Never attach it to
        // the current ticket/epoch or pay to reinterpret its original audio.
        return { kind: "received", receipt: { inboxId: turn.inboxId, sessionId: session.id, bindingId: null, ticketId: null, epoch: null } };
      }
      if (current.mode === "ai") return;
      if (!current.ticketId) throw new ConflictException("whatsapp_human_ticket_unavailable");
      await lockSupportResource(tx, `support:${current.ticketId}`);
      const ticket = await tx.supportTicket.findFirst({ where: { id: current.ticketId, merchantId: turn.scope.merchantId,
        sessionId: session.id, source: "whatsapp", status: { in: ["open", "in_progress"] }, mergedIntoId: null } });
      if (!ticket) throw new ConflictException("whatsapp_human_ticket_unavailable");
      const media = payload.metaMedia || payload.mediaUrl || payload.messageType === "audio";
      const origin = turn.origin === "voice" ? "voice" : media ? "media" : turn.origin;
      const content = turn.origin === "voice" ? turn.message : typeof payload.body === "string" ? payload.body : "";
      const message = await persistSupportMessage(tx, { merchantId: turn.scope.merchantId, ticketId: ticket.id,
        senderType: "buyer", clientMessageId, content: content || "Mensagem de mídia recebida.", metadata: {
          kind: "whatsapp_incoming", schemaVersion: 1, configId: turn.scope.configId, whatsappSessionId: session.id,
          inboxId: turn.inboxId, origin, bindingId: current.id, epoch: current.epoch,
          // The authenticated inbox retains the media reference. MIME/body do
          // not authorize a transcript, a fetch or an external sender.
          ...(media ? { media: { inboxId: turn.inboxId } } : {}),
        } });
      return { kind: "received", receipt: { inboxId: turn.inboxId, sessionId: session.id, bindingId: current.id,
        ticketId: ticket.id, epoch: current.epoch, messageId: message.id } };
    });
    if (result?.kind === "received") {
      if (input.provider === "META_CLOUD") {
        if (!await this.inbox.saveResponse?.(claim, { purpose: "human_received", phase: "complete", receipt: { ...result.receipt } })) throw new Error("whatsapp_inbox_lease_lost");
      } else await this.delivery.acknowledgeHumanInput(result.receipt);
    }
    return result;
  }
}
