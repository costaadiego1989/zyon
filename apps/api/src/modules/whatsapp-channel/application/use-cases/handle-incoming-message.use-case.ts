/**
 * Handle Incoming WhatsApp Message — Main Pipeline
 *
 * Orchestrates: debounce → route → resolve menu → engine → render → send
 *
 * Key: WhatsApp buyer is auto-authenticated by phone number.
 * Phone verified = true by default (no OTP needed).
 */

import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
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
} from "../../domain/ports/whatsapp-session-repository.port.js";

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
      ).catch(() => {});

      // Send response via WhatsApp
      await this.sendResponse.execute({
        merchantId: input.merchantId,
        deviceId: input.deviceId,
        toNumber: input.fromNumber,
        text: responseText,
      });

      this.logger.log(`WA response sent to ${input.fromNumber}`);
    } catch (error) {
      this.logger.error(`WA pipeline error for ${input.fromNumber}: ${error instanceof Error ? error.message : String(error)}`);

      // Fallback: try to send error message directly
      try {
        await this.sendResponse.execute({
          merchantId: input.merchantId,
          deviceId: input.deviceId,
          toNumber: input.fromNumber,
          text: "⚠️ Desculpe, tive um problema técnico. Tente novamente em alguns segundos.",
        });
      } catch { /* silent */ }
    }
  }

  private async processDebounced(msg: DebouncedMessage): Promise<void> {
    try {
      // Re-fetch session (may have been updated since push)
      const session = await this.sessionRepo.findActiveByPhone(msg.merchantId, msg.buyerPhone);
      if (!session) {
        this.logger.warn(`Session lost for ${msg.buyerPhone} during debounce`);
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
        `Error processing WA message for ${msg.buyerPhone}: ${error instanceof Error ? error.message : String(error)}`,
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
    this.logger.debug(`Engine call: session=${checkoutSessionId} msg="${buyerMessage}"`);

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
