import { createHash } from "node:crypto";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import {
  MARKETING_RELATIONSHIP,
  MERCHANT_MARKETING_MESSAGING,
  MARKETING_CONSENT_TEXT,
  type MarketingRelationshipPort,
  type MerchantMarketingMessaging,
  type MarketingInboundDecision,
} from "../../../../shared/contracts/marketing.js";
import { WhatsAppDeliveryService } from "../services/whatsapp-delivery.service.js";
import { WHATSAPP_CONVERSATION_PORT, type WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";
import { whatsappProcessingErrorCode } from "../../domain/services/whatsapp-processing-error.js";
/**
 * Handle Incoming WhatsApp Message — Main Pipeline
 *
 * Orchestrates: debounce → route → resolve menu → engine → render → send
 *
 * Key: WhatsApp buyer is auto-authenticated by phone number.
 * Phone verified = true by default (no OTP needed).
 */

import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { RouteToSessionUseCase, type RouteResult } from "./route-to-session.use-case.js";
import { SendWhatsAppResponseUseCase } from "./send-whatsapp-response.use-case.js";
import {
  resolveNumberedInput,
  buildMenuState,
} from "../services/whatsapp-menu-renderer.service.js";
import { renderNumberedMenu } from "../../domain/templates/whatsapp-templates.js";
import { HandleMetaConversationUseCase } from "./handle-meta-conversation.use-case.js";
import { WhatsAppHumanIntakeService } from "../services/whatsapp-human-intake.service.js";
import { WhatsAppHumanMessageRouter } from "../services/whatsapp-human-message-router.js";
import { WhatsAppAiDispatchFence, WhatsAppAiSuppressedError } from "../services/whatsapp-ai-dispatch-fence.js";
import type { WhatsAppHumanNotice } from "../services/whatsapp-human-intake.service.js";
import { currentWhatsAppExecution } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { readAiAuthority } from "../../domain/services/whatsapp-ai-authority.js";
import type { WhatsAppInboxClaim } from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import type { HumanInputReceipt } from "../services/whatsapp-human-message-router.js";
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
  catalogOrder?: import("../../infrastructure/adapters/meta-catalog-order.adapter.js").MetaCatalogOrder;
  metaMedia?: { id: string; mimeType?: string; name?: string };
  flowResponse?: Record<string, unknown>;
  interactiveId?: string;
  inboxClaim?: import("../../domain/ports/whatsapp-webhook-inbox.port.js").WhatsAppInboxClaim;
  /** Set only by the signature-verified Meta ingress, never by chat text. */
  adReferral?: { adId: string };
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
  /** Set only by an authenticated ingress that checked the provider's event timestamp. */
  providerTimestampVerified?: boolean;
  providerMessageId?: string;
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
    @Optional() private readonly metaConversation?: HandleMetaConversationUseCase,
    @Optional() @Inject(DOMAIN_EVENT_BUS) eventsOrHuman?: DomainEventBus | WhatsAppHumanIntakeService,
    @Optional() @Inject(MARKETING_RELATIONSHIP) marketingOrRouter?: MarketingRelationshipPort | WhatsAppHumanMessageRouter,
    @Optional() @Inject(MERCHANT_MARKETING_MESSAGING) messagingOrFence?: MerchantMarketingMessaging | WhatsAppAiDispatchFence,
    @Optional() private readonly delivery?: WhatsAppDeliveryService,
    @Optional() humanIntake?: WhatsAppHumanIntakeService,
    @Optional() humanRouter?: WhatsAppHumanMessageRouter,
    @Optional() aiFence?: WhatsAppAiDispatchFence,
  ) {
    this.events = eventsOrHuman && "publish" in eventsOrHuman ? eventsOrHuman : undefined;
    this.humanIntake = eventsOrHuman && !("publish" in eventsOrHuman) ? eventsOrHuman : humanIntake;
    this.marketing = marketingOrRouter && "enabled" in marketingOrRouter ? marketingOrRouter : undefined;
    this.humanRouter = marketingOrRouter && !("enabled" in marketingOrRouter) ? marketingOrRouter : humanRouter;
    this.marketingMessaging = messagingOrFence && "sendOpening" in messagingOrFence ? messagingOrFence : undefined;
    this.aiFence = messagingOrFence && !("sendOpening" in messagingOrFence) ? messagingOrFence : aiFence;
  }
  private readonly events?: DomainEventBus;
  private readonly marketing?: MarketingRelationshipPort;
  private readonly marketingMessaging?: MerchantMarketingMessaging;
  private readonly humanIntake?: WhatsAppHumanIntakeService;
  private readonly humanRouter?: WhatsAppHumanMessageRouter;
  private readonly aiFence?: WhatsAppAiDispatchFence;

  async execute(input: IncomingMessageInput): Promise<void> {
    try {
      const routeAndProcess = async () => {
        // Route: find/create session + buyer identity
        const route = await this.routeToSession.execute({
          merchantId: input.merchantId,
          deviceId: input.deviceId,
          fromNumber: input.fromNumber,
          fromAlias: input.fromAlias,
        });

        const run = () => this.processRouted(input, route);
        if (this.humanIntake) await this.humanIntake.runTurn(input, route, run);
        else await run();
      };
      const claim = input.inboxClaim ?? this.humanIntake?.currentClaim();
      const saved = claim?.responseState;
      if (this.aiFence && claim && saved && Object.keys(saved).length) {
        const authority = readAiAuthority(saved.aiAuthority);
        if (!authority) {
          if (!await this.aiFence.consumeHandoffReplay(claim)) await this.aiFence.suppressBeforeRouting(claim);
          return;
        }
        const raw = saved.purpose === "human_handoff" && saved.handoff && typeof saved.handoff === "object" && !Array.isArray(saved.handoff)
          ? saved.handoff as Record<string, unknown> : {};
        const notice: WhatsAppHumanNotice | undefined = raw.confirmed === true && typeof raw.ticketId === "string"
          && typeof raw.bindingId === "string" && typeof raw.epoch === "number" && typeof raw.reply === "string"
          ? { confirmed: true, ticketId: raw.ticketId, bindingId: raw.bindingId, epoch: raw.epoch, reply: raw.reply } : undefined;
        if (saved.purpose === "human_handoff" && !notice) {
          if (!await this.aiFence.consumeHandoffReplay(claim)) await this.aiFence.suppressBeforeRouting(claim);
          return;
        }
        try { await this.aiFence.restore(claim, authority, routeAndProcess, notice); }
        catch (error) {
          if (!(error instanceof WhatsAppAiSuppressedError)) throw error;
          if (saved.purpose === "human_handoff" && await this.aiFence.consumeHandoffReplay(claim)) return;
          if (!await this.recordSuppressed(claim, authority)) await this.aiFence.suppressBeforeRouting(claim);
        }
        return;
      }
      await routeAndProcess();
    } catch (error) {
      this.logger.error(`whatsapp_pipeline_failed merchant=${input.merchantId} code=${whatsappProcessingErrorCode(error)}`);

      // Let the durable inbox retry; sending a fallback here would be another side effect.
      throw error;
    }
  }

  private async processRouted(input: IncomingMessageInput, route: RouteResult): Promise<void> {
    // Process inline under the durable inbox lease.
    const session = route.whatsappSession;
    const humanRoute = await this.humanRouter?.route(input);
    if (humanRoute?.kind === "received") return;
    if (humanRoute?.kind === "notice") {
      await this.sendNotice(input, route, humanRoute.notice);
      return;
    }
    const claim = input.inboxClaim ?? this.humanIntake?.currentClaim();
    if (this.aiFence) {
      if (!claim) throw new Error("whatsapp_turn_context_required");
      try { await this.aiFence.run(claim, () => this.processAiWithNotice(input, route)); }
      catch (error) {
        if (!(error instanceof WhatsAppAiSuppressedError)) throw error;
        // Preserve authenticated input for the exact human case when one now
        // owns the conversation; otherwise record truthful suppression only.
        const authority = currentWhatsAppExecution()?.authority ?? (await this.aiFence.originalForSuppression(claim));
        const received = await this.recordSuppressed(claim, authority);
        if (!received) await this.aiFence.suppress(claim);
      }
      return;
    }
    await this.processAiWithNotice(input, route);
  }

  /** Called by the durable delivery owner as well as the live pipeline. It
   * never routes/creates a checkout or recaptures the current AI epoch. */
  async recordSuppressed(claim: WhatsAppInboxClaim, authority: unknown): Promise<HumanInputReceipt | undefined> {
    if (!this.aiFence || !this.humanRouter) return;
    return this.aiFence.withSuppressedInput(claim, authority, async (payload, expected) => {
      const result = await this.humanRouter!.routeSuppressed({ ...payload, inboxClaim: claim }, expected);
      if (result?.kind !== "received") return;
      await this.aiFence!.suppress(claim, result.receipt);
      return result.receipt;
    });
  }

  private async sendNotice(input: IncomingMessageInput, route: RouteResult, notice: WhatsAppHumanNotice): Promise<void> {
    const send = async () => {
      if (input.provider === "META_CLOUD") {
        if (!this.metaConversation) throw new Error("whatsapp_native_conversation_unavailable");
        await this.metaConversation.sendHandoffNotice(input, route, notice);
      } else await this.sendResponse.execute({ merchantId: input.merchantId, deviceId: input.deviceId,
        toNumber: input.fromNumber, text: notice.reply, provider: input.provider });
    };
    if (!this.aiFence) return send();
    const claim = input.inboxClaim ?? this.humanIntake?.currentClaim();
    const authority = readAiAuthority(currentWhatsAppExecution()?.authority ?? claim?.responseState?.aiAuthority);
    if (!claim || !authority) {
      if (claim) await this.aiFence.suppress(claim);
      return;
    }
    return this.aiFence.notice(claim, authority, notice, send);
  }

  private async processAiWithNotice(input: IncomingMessageInput, route: RouteResult): Promise<void> {
    try { await this.processAiRouted(input,route); }
    catch(error) {
      // A tool may have canonically handed off before ordinary generation is
      // suppressed by the changed epoch. Consume once inside original context.
      const notice=this.humanIntake?.takeNotice();if(!notice)throw error;
      await this.sendNotice(input,route,notice);
    }
  }

  private async processAiRouted(input: IncomingMessageInput, route: RouteResult): Promise<void> {
    const session = route.whatsappSession;
    if (this.humanIntake && input.provider === "META_CLOUD" && await this.metaConversation?.resumeHandoffNotice(input, route)) return;
    const preparedMedia = this.humanIntake && input.provider === "META_CLOUD" ? await this.metaConversation?.prepareAudioForHandoff(input, route) : undefined;
    const notice = await this.humanIntake?.requestText(input) ?? (preparedMedia ? await this.humanIntake?.requestVoice(input, preparedMedia.result) : undefined);
    if (notice) {
      await this.sendNotice(input, route, notice);
      return;
    }


      const messageId =
        input.providerMessageId ??
        createHash("sha256")
          .update(
            JSON.stringify([
              input.merchantId,
              input.deviceId,
              input.fromNumber,
              input.timestamp,
              input.body,
            ])
          )
          .digest("hex");
      let relationship: MarketingInboundDecision | undefined;
      if (input.provider !== "META_CLOUD" && this.marketing && (await this.marketing.enabled(input.merchantId))) {
        if (!session.checkoutSessionId)
          throw new Error("whatsapp_checkout_session_missing");
        relationship = await this.marketing.inbound({
          merchantId: input.merchantId,
          channel: "whatsapp",
          conversationKey: session.checkoutSessionId,
          messageId,
          text: input.body.slice(0, 8000),
          verifiedPhone: input.fromNumber,
          deviceId: input.deviceId,
          receivedAt: new Date(
            input.providerTimestampVerified ? input.timestamp : Date.now()
          ).toISOString(),
        });
        if (relationship.human) { await this.delivery?.suppress(); return; }
        if (relationship.openingRequired) {
          const opened = await this.marketing.opening(
            input.merchantId,
            relationship.conversationId,
            async () => {
              if (input.provider === "META_CLOUD" && this.marketingMessaging)
                return this.marketingMessaging.sendOpening({
                  merchantId: input.merchantId,
                  phone: input.fromNumber.replace(/\D/g, ""),
                  deviceId: input.deviceId,
                  text: MARKETING_CONSENT_TEXT,
                });
              return this.sendResponse.execute({
                merchantId: input.merchantId,
                deviceId: input.deviceId,
                toNumber: input.fromNumber,
                provider: input.provider,
                text: `${MARKETING_CONSENT_TEXT}\n\nResponda “Quero receber” ou “Agora não”. Seu atendimento continua em qualquer opção.`,
              });
            }
          );
          if (!opened) await this.delivery?.suppress();
          return;
        }
        if (relationship.optedOut) {
          await this.sendServiceReply(
            {
              merchantId: input.merchantId,
              deviceId: input.deviceId,
              toNumber: input.fromNumber,
              provider: input.provider,
              text: "Você não receberá mais promoções desta loja. Seu atendimento continua disponível.",
            },
            relationship,
            messageId
          );
          return;
        }
      }
      const serviceInput = relationship
        ? { ...input, body: relationship.originalQuestion }
        : input;


      if (input.provider === "META_CLOUD" && input.adReferral && session.checkoutSessionId) {
        const eventId=input.inboxClaim?.dedupKey??createHash('sha256').update(JSON.stringify([input.merchantId,input.deviceId,input.timestamp,session.checkoutSessionId,input.adReferral.adId])).digest('hex');
        await this.events?.publish({ eventType: "whatsapp.ad_referral", merchantId: input.merchantId,eventId, payload: { adId: input.adReferral.adId, sessionId: session.checkoutSessionId } });
      }


    // ─── Post-sale reply intercept ────────────────────────────────────
    // If the buyer was asked for NPS/review via post-sale, capture reply
    // before routing to the checkout engine.
    if (session.postSaleContext && this.postSaleReply) {
      const speech = this.humanIntake?.currentSpeech();
      const postSaleInput = speech ? { ...serviceInput, body: speech } : serviceInput;
      if (input.provider === "META_CLOUD" && this.metaConversation) {
        await this.metaConversation.execute(input, route, async (message) => {
          let text = "";
          const handled = await this.handlePostSaleReply(session, { ...postSaleInput, body: message }, async response => { text = response.text; });
          if (!handled) throw new Error("whatsapp_post_sale_context_invalid");
          return { agentMessage: text, blocks: [], quickReplies: [], state: {
            ...(session.conversationState ?? { version: 1, conversationId: crypto.randomUUID(), stage: "store", history: [], revision: "", page: 0, previousViews: [] }),
            expectsFreeInput: true,
          } };
        }, preparedMedia);
        return;
      }
      const handled = await this.handlePostSaleReply(session, postSaleInput, response => this.sendServiceReply(response, relationship, messageId));
      if (handled) return; // reply captured; don't fall through to checkout
    }
    // ────────────────────────────────────────────────────────────────────

    if (input.provider === "META_CLOUD") {
      if (!this.metaConversation) throw new Error("whatsapp_native_conversation_unavailable");
      await this.metaConversation.execute(input, route, undefined, preparedMedia);
      return;
    }

    // Resolve numbered input
    const menuState = buildMenuState(
      session.currentOptions,
      { currentOptions: session.previousOptions, previousOptions: [], page: session.currentPage, context: "menu" },
    );
    const resolved = resolveNumberedInput(serviceInput.body, menuState);

    let textForEngine: string;
    switch (resolved.action) {
      case "select": textForEngine = resolved.text; break;
      case "back": textForEngine = "Voltar ao menu anterior"; break;
      case "more": textForEngine = "Mostrar mais produtos"; break;
      default: textForEngine = serviceInput.body; break;
    }

      // Get response from engine
      if (!session.checkoutSessionId)
        throw new Error("whatsapp_checkout_session_missing");
      const history =
        relationship && this.marketing
          ? await this.marketing.history(
              input.merchantId,
              "whatsapp",
              session.checkoutSessionId
            )
          : null;
      const humanContext = history?.some((message) => message.role === "agent")
        ? history
            .filter(
              (message) =>
                ["buyer", "agent", "ai"].includes(message.role) &&
                ["recorded", "accepted", "delivered", "read"].includes(
                  message.status
                )
            )
            .slice(0, -1)
            .slice(-20)
            .map((message) => ({
              role:
                message.role === "buyer"
                  ? ("user" as const)
                  : ("assistant" as const),
              content: message.content,
            }))
        : undefined;
      const engineResponse = await this.conversation.respond({
        merchantId: input.merchantId,
        checkoutSessionId: session.checkoutSessionId,
        message: textForEngine,
        requestId: relationship?.responseKey ?? messageId,
        ...(humanContext ? { humanContext } : {}),
      });
    const confirmed=this.humanIntake?.takeNotice();
    if(confirmed){await this.sendNotice(input,route,confirmed);return;}
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
      const deliver = () =>
        this.sendResponse.execute({
          merchantId: input.merchantId,
          deviceId: input.deviceId,
          toNumber: input.fromNumber,
          text: responseText,
          provider: input.provider,
        });
      if (relationship && this.marketing) {
        await this.marketing.aiReply(
          input.merchantId,
          relationship.conversationId,
          relationship.responseKey ?? messageId,
          responseText,
          deliver
        );
        await this.marketing.commerce(
          input.merchantId,
          session.checkoutSessionId
        );
      } else await deliver();


    this.logger.log(`whatsapp_response_sent merchant=${input.merchantId}`);
  }

  /**
   * Captures a buyer reply to a post-sale NPS/review WhatsApp message.
   * Returns true when the reply was handled (so the caller skips the checkout engine).
   */
  private async handlePostSaleReply(
    session: WhatsAppSessionEntity,
    input: IncomingMessageInput,
    capturedSend?: (response: import("./send-whatsapp-response.use-case.js").SendResponseInput) => Promise<void>,
  ): Promise<boolean> {
    const ctx = session.postSaleContext;
    if (!ctx || !this.postSaleReply) return false;

    const reply = input.body.trim();
    const send = capturedSend ?? ((response: import("./send-whatsapp-response.use-case.js").SendResponseInput) => this.sendResponse.execute(response));

    if (ctx.stage === "awaiting_nps") {
      // Parse a 1–5 star rating from the reply.
      const match = reply.match(/\b([1-5])\b/);
      const rating = match ? Number(match[1]) : NaN;

      if (Number.isNaN(rating) || rating < 1 || rating > 5) {
        await send({
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

      await send({
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

      await send({
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

  private async sendServiceReply(
    input: Parameters<SendWhatsAppResponseUseCase["execute"]>[0],
    relationship: MarketingInboundDecision | undefined,
    messageId: string
  ) {
    const deliver = () => this.sendResponse.execute(input);
    if (relationship && this.marketing)
      await this.marketing.aiReply(
        input.merchantId,
        relationship.conversationId,
        `post-sale:${messageId}`,
        input.text,
        deliver
      );
    else await deliver();
  }
}
