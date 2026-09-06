/**
 * Handle Incoming WhatsApp Message — Main Pipeline
 *
 * Orchestrates: debounce → route → resolve menu → engine → render → send
 *
 * Key: WhatsApp buyer is auto-authenticated by phone number.
 * Phone verified = true by default (no OTP needed).
 */

import { Injectable, Inject, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { MessageDebouncerService, type DebouncedMessage } from "../services/message-debouncer.service.js";
import { RouteToSessionUseCase } from "./route-to-session.use-case.js";
import { SendWhatsAppResponseUseCase } from "./send-whatsapp-response.use-case.js";
import {
  resolveNumberedInput,
  buildMenuState,
} from "../services/whatsapp-menu-renderer.service.js";
import { renderNumberedMenu, renderProcessing } from "../../domain/templates/whatsapp-templates.js";
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
export class HandleIncomingMessageUseCase implements OnModuleInit {
  private readonly logger = new Logger(HandleIncomingMessageUseCase.name);

  constructor(
    private readonly debouncer: MessageDebouncerService,
    private readonly routeToSession: RouteToSessionUseCase,
    private readonly sendResponse: SendWhatsAppResponseUseCase,
    @Inject(WHATSAPP_SESSION_REPOSITORY)
    private readonly sessionRepo: WhatsAppSessionRepository,
    @Optional() @Inject(POST_SALE_REPLY_HANDLER_PORT)
    private readonly postSaleReply?: PostSaleReplyHandlerPort,
  ) {}

  onModuleInit() {
    this.debouncer.onFlush((msg) => this.processDebounced(msg));
  }

  async execute(input: IncomingMessageInput): Promise<void> {
    try {
      // Route: find/create session + buyer identity
      const route = await this.routeToSession.execute({
        merchantId: input.merchantId,
        deviceId: input.deviceId,
        fromNumber: input.fromNumber,
        fromAlias: input.fromAlias,
      });

      // Phase 1: process inline (skip debouncer for reliability)
      // Phase 2: re-enable debouncer for batching rapid messages
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
        case "back": textForEngine = "__NAVIGATE_BACK__"; break;
        case "more": textForEngine = "__LOAD_MORE__"; break;
        default: textForEngine = input.body; break;
      }

      // Get response from engine
      const engineResponse = await this.callEngine(session.checkoutSessionId ?? "", textForEngine);
      const quickReplies: string[] = engineResponse?.quickReplies ?? ["Ver Produtos", "Categorias", "Suporte"];
      const agentText: string = engineResponse?.agentMessage ?? "Como posso te ajudar?";

      const responseText = `${agentText}\n\n${renderNumberedMenu(quickReplies, true)}`;

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
        this.logger.error(`Failed to submit NPS reply: ${err instanceof Error ? err.message : String(err)}`);
      }

      await this.sessionRepo.clearPostSaleContext(session.id).catch(() => {});

      const thanks = rating >= 5
        ? `Uhul! 🎉 5 estrelas! Que bom que você curtiu, ${session.buyerAlias ?? ""}! Muito obrigado! 💛`
        : rating >= 4
          ? `Valeu pelas ${rating} estrelas! 🙏 Vamos trabalhar pra chegar nas 5 na próxima! ⭐`
          : `Obrigado pela sinceridade — ${rating} estrela${rating > 1 ? "s" : ""} anotada${rating > 1 ? "s" : ""}. Vamos melhorar pra você! 💪`;

      await this.sendResponse.execute({
        merchantId: input.merchantId,
        deviceId: input.deviceId,
        toNumber: input.fromNumber,
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
        this.logger.warn("Review reply received but context has no productId", { orderId: ctx.orderId });
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
          this.logger.error(`Failed to submit review reply: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      await this.sessionRepo.clearPostSaleContext(session.id).catch(() => {});

      await this.sendResponse.execute({
        merchantId: input.merchantId,
        deviceId: input.deviceId,
        toNumber: input.fromNumber,
        text: `Muito obrigado pela sua avaliação! ⭐ Sua opinião ajuda demais outros clientes. 💛`,
      });
      return true;
    }

    return false;
  }

  private async processDebounced(msg: DebouncedMessage): Promise<void> {
    try {
      // Re-fetch session (may have been updated since push)
      const session = await this.sessionRepo.findActiveByPhone(msg.merchantId, msg.buyerPhone);
      if (!session) {
        this.logger.warn(`whatsapp_debounce_session_missing merchant=${msg.merchantId}`);
        return;
      }

      // Resolve numbered input against current menu state
      const menuState = buildMenuState(
        session.currentOptions,
        { currentOptions: session.previousOptions, previousOptions: [], page: session.currentPage, context: "menu" },
      );

      const resolved = resolveNumberedInput(msg.combinedText, menuState);

      let textForEngine: string;
      switch (resolved.action) {
        case "select":
          textForEngine = resolved.text;
          break;
        case "back":
          textForEngine = "__NAVIGATE_BACK__";
          break;
        case "more":
          textForEngine = "__LOAD_MORE__";
          break;
        case "freetext":
        default:
          textForEngine = msg.combinedText;
          break;
      }

      // Call the existing checkout/storefront engine
      // This is the same send-chat-message use-case the widget uses
      // The engine returns: { agentMessage, quickReplies, stage, ... }
      const engineResponse = await this.callEngine(session.checkoutSessionId!, textForEngine);

      // Format response with numbered menu
      const quickReplies: string[] = engineResponse?.quickReplies ?? [];
      const agentText: string = engineResponse?.agentMessage ?? "Como posso ajudar?";

      const responseText = quickReplies.length > 0
        ? `${agentText}\n\n${renderNumberedMenu(quickReplies, true)}`
        : agentText;

      // Update menu state on session
      await this.sessionRepo.updateMenuState(
        session.id,
        quickReplies,
        session.currentOptions,
        session.currentPage,
      );

      // Send via WhatsApp
      await this.sendResponse.execute({
        merchantId: msg.merchantId,
        deviceId: session.deviceId,
        toNumber: msg.buyerPhone,
        text: responseText,
      });

    } catch (error) {
      this.logger.error(
        `whatsapp_debounce_processing_failed merchant=${msg.merchantId}`,
      );
    }
  }

  /**
   * Call the existing conversation engine (send-chat-message use-case).
   * Returns agent text + quick replies.
   *
   * Phase 1: Returns welcome/default responses while full engine wiring is in progress.
   * Phase 2: Wire to SendChatMessageUseCase for full AI responses.
   */
  private async callEngine(
    checkoutSessionId: string,
    buyerMessage: string,
  ): Promise<{ agentMessage: string; quickReplies: string[]; stage?: string } | null> {
    this.logger.debug(`whatsapp_engine_call session=${checkoutSessionId}`);

    // Phase 1: deterministic responses for testing the WA channel
    const msg = buyerMessage.toLowerCase().trim();

    if (msg === "__navigate_back__") {
      return {
        agentMessage: "↩️ Voltando ao menu anterior...",
        quickReplies: ["Ver Produtos", "Categorias", "Meu Carrinho", "Suporte"],
        stage: "welcome",
      };
    }

    if (msg === "__load_more__") {
      return {
        agentMessage: "Carregando mais produtos...",
        quickReplies: ["Selecionar Produto", "Filtrar Produtos", "Categorias"],
        stage: "browsing",
      };
    }

    // Welcome / greeting
    if (/^(oi|olá|ola|hey|bom dia|boa tarde|boa noite|hi|hello)/.test(msg)) {
      return {
        agentMessage: "👋 Olá! Bem-vindo à nossa loja!\n\nSou o assistente virtual e posso te ajudar a encontrar produtos e fazer seu pedido.\n\nComo posso te ajudar?",
        quickReplies: ["Ver Produtos", "Encontrar Produto", "Categorias", "Ofertas", "Rastrear Pedido", "Suporte"],
        stage: "welcome",
      };
    }

    // Product browsing intent
    if (/produto|ver|catalogo|catálogo|comprar|loja/.test(msg) || msg === "ver produtos") {
      return {
        agentMessage: "🛍️ *Nossos Produtos*\n\nO que você está procurando? Posso buscar por nome ou mostrar as categorias.",
        quickReplies: ["Selecionar Produto", "Filtrar Produtos", "Categorias", "Ofertas do Dia"],
        stage: "browsing",
      };
    }

    // Categories
    if (/categoria|segmento/.test(msg) || msg === "categorias") {
      return {
        agentMessage: "📂 *Categorias*\n\nEscolha uma categoria para ver os produtos:",
        quickReplies: ["Encontrar um Produto", "Categorias em Promoção"],
        stage: "categories",
      };
    }

    // Cart
    if (/carrinho|cart|meu pedido/.test(msg)) {
      return {
        agentMessage: "🛒 Seu carrinho está vazio no momento.\n\nQue tal ver nossos produtos?",
        quickReplies: ["Ver Produtos", "Categorias", "Ofertas"],
        stage: "welcome",
      };
    }

    // Support
    if (/suporte|ajuda|humano|atendente/.test(msg)) {
      return {
        agentMessage: "🙋 Como posso te ajudar?\n\nSe precisar de um atendente humano, é só pedir.",
        quickReplies: ["FAQ", "Falar com Humano", "Reportar Problema", "Status do Pedido"],
        stage: "support",
      };
    }

    // Default fallback
    return {
      agentMessage: "Não entendi completamente. Escolha uma opção abaixo ou digite o que procura:",
      quickReplies: ["Ver Produtos", "Categorias", "Meu Carrinho", "Suporte"],
      stage: "welcome",
    };
  }
}
