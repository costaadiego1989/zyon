import { WHATSAPP_CONVERSATION_PORT, type WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";
/**
 * Handle Incoming WhatsApp Message — Main Pipeline
 *
 * Orchestrates: debounce → route → resolve menu → engine → render → send
 *
 * Key: WhatsApp buyer is auto-authenticated by phone number.
 * Phone verified = true by default (no OTP needed).
 */

import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { RouteToSessionUseCase } from "./route-to-session.use-case.js";
import { SendWhatsAppResponseUseCase } from "./send-whatsapp-response.use-case.js";
import {
  resolveNumberedInput,
  buildMenuState,
} from "../services/whatsapp-menu-renderer.service.js";
import { renderNumberedMenu } from "../../domain/templates/whatsapp-templates.js";
import {
  WHATSAPP_SESSION_REPOSITORY,
  type WhatsAppSessionRepository,
  type WhatsAppSessionEntity,
} from "../../domain/ports/whatsapp-session-repository.port.js";
import {
  POST_SALE_REPLY_HANDLER_PORT,
  type PostSaleReplyHandlerPort,
} from "../../../post-sale/domain/ports/post-sale-reply-handler.port.js";

export interface IncomingMessageInput {
  merchantId: string;
  deviceId: string;
  fromNumber: string;
  fromAlias?: string;
  body: string;
  messageType: string;
  mediaUrl?: string;
  mimetype?: string;
  timestamp: number;
  provider?: string; // BUBBLEWHATS | TWILIO (default BUBBLEWHATS for backward compat)
}

@Injectable()
export class HandleIncomingMessageUseCase {
  private readonly logger = new Logger(HandleIncomingMessageUseCase.name);

  constructor(
    private readonly routeToSession: RouteToSessionUseCase,
    private readonly sendResponse: SendWhatsAppResponseUseCase,
    @Inject(WHATSAPP_SESSION_REPOSITORY)
    private readonly sessionRepo: WhatsAppSessionRepository,
    @Inject(WHATSAPP_CONVERSATION_PORT)
    private readonly conversation: WhatsAppConversationPort,
    @Optional() @Inject(POST_SALE_REPLY_HANDLER_PORT)
    private readonly postSaleReply?: PostSaleReplyHandlerPort,
  ) {}

  async execute(input: IncomingMessageInput): Promise<void> {
    try {
      // Route: find/create session + buyer identity
      const route = await this.routeToSession.execute({
        merchantId: input.merchantId,
        deviceId: input.deviceId,
        fromNumber: input.fromNumber,
        fromAlias: input.fromAlias,
      });

      // Process inline under the durable inbox lease.
      const session = route.whatsappSession;

      // ─── Post-sale reply intercept ────────────────────────────────────
      // If the buyer was asked for NPS/review via post-sale, capture reply
      // before routing to the checkout engine.
      if (session.postSaleContext && this.postSaleReply) {
        const handled = await this.handlePostSaleReply(session, input);
        if (handled) return; // reply captured; don't fall through to checkout
      }
      // ────────────────────────────────────────────────────────────────────

      // Resolve numbered input
      const menuState = buildMenuState(
        session.currentOptions,
        { currentOptions: session.previousOptions, previousOptions: [], page: session.currentPage, context: "menu" },
      );
      const resolved = resolveNumberedInput(input.body, menuState);

      let textForEngine: string;
      switch (resolved.action) {
        case "select": textForEngine = resolved.text; break;
        case "back": textForEngine = "Voltar ao menu anterior"; break;
        case "more": textForEngine = "Mostrar mais produtos"; break;
        default: textForEngine = input.body; break;
      }

      // Get response from engine
      if (!session.checkoutSessionId) throw new Error("whatsapp_checkout_session_missing");
      const engineResponse = await this.conversation.respond({
        merchantId: input.merchantId, checkoutSessionId: session.checkoutSessionId, message: textForEngine,
      });
      const quickReplies: string[] = engineResponse.quickReplies;
      const agentText: string = engineResponse.agentMessage;

      const responseText = quickReplies.length ? `${agentText}\n\n${renderNumberedMenu(quickReplies, true)}` : agentText;

      // Save menu state
      await this.sessionRepo.updateMenuState(
        session.id,
        quickReplies,
        session.currentOptions,
        session.currentPage,
      );

      // Send response via WhatsApp
      await this.sendResponse.execute({
        merchantId: input.merchantId,
        deviceId: input.deviceId,
        toNumber: input.fromNumber,
        text: responseText,
        provider: input.provider,
      });

      this.logger.log(`whatsapp_response_sent merchant=${input.merchantId}`);
    } catch (error) {
      this.logger.error(`whatsapp_pipeline_failed merchant=${input.merchantId}`);

      // Let the durable inbox retry; sending a fallback here would be another side effect.
      throw error;
    }
  }

  /**
   * Captures a buyer reply to a post-sale NPS/review WhatsApp message.
   * Returns true when the reply was handled (so the caller skips the checkout engine).
   */
  private async handlePostSaleReply(
    session: WhatsAppSessionEntity,
    input: IncomingMessageInput,
  ): Promise<boolean> {
    const ctx = session.postSaleContext;
    if (!ctx || !this.postSaleReply) return false;

    const reply = input.body.trim();

    if (ctx.stage === "awaiting_nps") {
      // Parse a 1–5 star rating from the reply.
      const match = reply.match(/\b([1-5])\b/);
      const rating = match ? Number(match[1]) : NaN;

      if (Number.isNaN(rating) || rating < 1 || rating > 5) {
        await this.sendResponse.execute({
          merchantId: input.merchantId,
          deviceId: input.deviceId,
          toNumber: input.fromNumber,
          provider: input.provider,
          text: "Ops! 😅 Não entendi. Pode responder com um número de *1 a 5* (estrelas)? É rapidinho! ⭐",
        });
        return true; // keep context; wait for a valid number
      }

      // Any text after the number becomes optional feedback.
      const feedback = reply.replace(/\b[1-5]\b/, "").trim() || undefined;

      // Convert 1-5 stars → NPS 0-10 for the NPS model (1→2, 2→4, 3→6, 4→8, 5→10)
      const npsScore = rating * 2;

      try {
        await this.postSaleReply.handleNpsReply({
          merchantId: input.merchantId,
          buyerId: ctx.buyerId,
          orderId: ctx.orderId,
          score: npsScore,
          feedback,
        });
      } catch (err) {
        this.logger.error("whatsapp_nps_persistence_failed");
        throw err;
      }

      await this.sessionRepo.clearPostSaleContext(session.id);

      const thanks = rating >= 5
        ? `Uhul! 🎉 5 estrelas! Que bom que você curtiu, ${session.buyerAlias ?? ""}! Muito obrigado! 💛`
        : rating >= 4
          ? `Valeu pelas ${rating} estrelas! 🙏 Vamos trabalhar pra chegar nas 5 na próxima! ⭐`
          : `Obrigado pela sinceridade — ${rating} estrela${rating > 1 ? "s" : ""} anotada${rating > 1 ? "s" : ""}. Vamos melhorar pra você! 💪`;

      await this.sendResponse.execute({
        merchantId: input.merchantId,
        deviceId: input.deviceId,
        toNumber: input.fromNumber,
        provider: input.provider,
        text: thanks,
      });
      return true;
    }

    if (ctx.stage === "awaiting_review") {
      // Treat the whole reply as the review body. Infer a rating if a 1–5 leads the text.
      const ratingMatch = reply.match(/^\s*([1-5])\b/);
      const rating = ratingMatch ? Number(ratingMatch[1]) : undefined;
      const text = reply.replace(/^\s*[1-5]\b[\s.,-]*/, "").trim() || reply;

      if (!ctx.productId) {
        // No product to attach the review to — thank and clear rather than lose it.
        throw new Error("whatsapp_review_product_missing");
      } else {
        try {
          await this.postSaleReply.handleReviewReply({
            merchantId: input.merchantId,
            buyerId: ctx.buyerId,
            productId: ctx.productId,
            orderId: ctx.orderId,
            text,
            rating,
          });
        } catch (err) {
          this.logger.error("whatsapp_review_persistence_failed");
          throw err;
        }
      }

      await this.sessionRepo.clearPostSaleContext(session.id);

      await this.sendResponse.execute({
        merchantId: input.merchantId,
        deviceId: input.deviceId,
        toNumber: input.fromNumber,
        provider: input.provider,
        text: `Muito obrigado pela sua avaliação! ⭐ Sua opinião ajuda demais outros clientes. 💛`,
      });
      return true;
    }

    return false;
  }

}
