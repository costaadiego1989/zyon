import { Injectable } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { SupportHandoffService } from "../../../support/application/support-handoff.service.js";
import { WhatsAppTurnContext, isHumanSupportRequest, type VerifiedWhatsAppTurn } from "../../domain/services/whatsapp-turn-context.js";
import type { IncomingMessageInput } from "../use-cases/handle-incoming-message.use-case.js";
import type { RouteResult } from "../use-cases/route-to-session.use-case.js";
import type { MetaInboundMediaResult } from "../../infrastructure/adapters/meta-inbound-media.adapter.js";
import { WhatsAppDeliveryService } from "./whatsapp-delivery.service.js";

export interface WhatsAppHumanNotice { confirmed: boolean; reply: string; ticketId?: string; bindingId?: string; epoch?: number }

@Injectable()
export class WhatsAppHumanIntakeService {
  constructor(private readonly handoff: SupportHandoffService, private readonly context: WhatsAppTurnContext,
    private readonly delivery: WhatsAppDeliveryService) {}

  runTurn<T>(input: IncomingMessageInput, route: RouteResult, work: () => T): T {
    const claim = input.inboxClaim ?? this.delivery.currentClaim();
    const { inboxClaim: _claim, ...envelope } = input;
    const session = route.whatsappSession;
    if (!claim || claim.kind !== "message" || claim.merchantId !== input.merchantId || claim.deviceId !== input.deviceId
      || session.merchantId !== input.merchantId || session.deviceId !== input.deviceId || !claim.leaseToken
      || !isDeepStrictEqual(claim.payload, envelope)) throw new Error("whatsapp_turn_context_invalid");
    const turn: VerifiedWhatsAppTurn = { scope: { merchantId: input.merchantId, configId: claim.configId, whatsappSessionId: session.id },
      inboxId: claim.id, leaseToken: claim.leaseToken,
      conversationId: session.conversationState?.conversationId ?? session.checkoutSessionId ?? session.id,
      message: input.body, origin: input.interactiveId ? "button" : "text" };
    return this.context.run(turn, work);
  }

  async requestText(input: IncomingMessageInput): Promise<WhatsAppHumanNotice | undefined> {
    if (input.metaMedia || input.messageType === "audio" || /^audio\//i.test(input.mimetype ?? "") || !isHumanSupportRequest(input.body)) return;
    return this.persistCurrent();
  }

  currentSpeech(): string | undefined {
    const turn = this.context.current();
    return turn?.origin === "voice" ? turn.message : undefined;
  }

  currentClaim() { return this.delivery.currentClaim(); }

  async requestVoice(input: IncomingMessageInput, interpreted: MetaInboundMediaResult | undefined): Promise<WhatsAppHumanNotice | undefined> {
    const turn = this.context.current();
    if (!turn || interpreted?.kind !== "audio_transcript" || !interpreted.scope || !input.metaMedia || typeof interpreted.text !== "string"
      || !interpreted.text.trim() || interpreted.text.length > 4000 || interpreted.scope.merchantId !== turn.scope.merchantId
      || interpreted.scope.deviceId !== input.deviceId || interpreted.scope.inboxId !== turn.inboxId
      || interpreted.scope.conversationId !== turn.conversationId || interpreted.scope.mediaId !== input.metaMedia.id) return;
    this.context.authorizeSpeech(interpreted.text);
    if (isHumanSupportRequest(interpreted.text)) return this.persistCurrent();
  }

  private async persistCurrent(): Promise<WhatsAppHumanNotice | undefined> {
    const turn = this.context.current();
    if (!turn) return;
    try {
      const result = await this.handoff.createWhatsAppHandoff({ ...turn, message: turn.message });
      return { confirmed: true, reply: result.reply, ticketId: result.ticketId, bindingId: result.binding.id, epoch: result.binding.epoch };
    } catch {
      // The commit might be uncertain. Do not retry the write or announce a
      // successful/failed ticket that was not canonically confirmed.
      return { confirmed: false, reply: "🤝 *Atendimento humano*\n\nNão consegui confirmar o encaminhamento agora. Sua mensagem permanece registrada nesta conversa. Tente novamente em instantes." };
    }
  }
}
