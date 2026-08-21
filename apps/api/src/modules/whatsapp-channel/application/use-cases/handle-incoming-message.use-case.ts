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
    // Route first (to get session ID for debouncer key)
    const route = await this.routeToSession.execute({
      merchantId: input.merchantId,
      deviceId: input.deviceId,
      fromNumber: input.fromNumber,
      fromAlias: input.fromAlias,
    });

    // Push to debouncer (5s window)
    this.debouncer.push(
      route.whatsappSession.id,
      input.merchantId,
      input.fromNumber,
      input.body,
    );
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
   * TODO: Wire to actual SendChatMessageUseCase injection.
   * For now, this is a placeholder that will be wired during integration.
   */
  private async callEngine(
    checkoutSessionId: string,
    buyerMessage: string,
  ): Promise<{ agentMessage: string; quickReplies: string[]; stage?: string } | null> {
    // This will be replaced with actual use-case call:
    // const result = await this.sendChatMessage.execute({ sessionId, message: buyerMessage });
    // return { agentMessage: result.chatTurn.agent.text, quickReplies: result.experience.copy.quick_replies };
    this.logger.debug(`Engine call: session=${checkoutSessionId} msg="${buyerMessage}"`);
    return null;
  }
}
