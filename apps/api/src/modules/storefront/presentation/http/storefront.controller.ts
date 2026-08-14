/**
 * Storefront controller — REST endpoints for storefront conversations.
 *
 * Routes:
 *   POST /storefront/conversations — start conversation
 *   POST /storefront/conversations/:conversationId/messages — send message
 *   GET  /storefront/conversations/:conversationId — get history
 */

import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";
import { StartStoreConversationUseCase } from "../../application/use-cases/start-store-conversation.use-case.js";
import { SendStoreMessageUseCase } from "../../application/use-cases/send-store-message.use-case.js";
import { GetConversationHistoryUseCase } from "../../application/use-cases/get-conversation-history.use-case.js";

export interface StartConversationRequest {
  merchant_id: string;
  initial_message?: string;
}

export interface SendMessageRequest {
  user_message: string;
  cart_id?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

@NonProductionRoute()
@Controller("storefront")
export class StorefrontController {
  constructor(
    private readonly startStoreConversation: StartStoreConversationUseCase,
    private readonly sendStoreMessage: SendStoreMessageUseCase,
    private readonly getConversationHistory: GetConversationHistoryUseCase
  ) {}

  @Post("conversations")
  async startConversation(@Body() body: StartConversationRequest) {
    return this.startStoreConversation.execute(body);
  }

  @Post("conversations/:conversationId/messages")
  async sendMessage(
    @Param("conversationId") conversationId: string,
    @Body() body: SendMessageRequest & { merchant_id: string }
  ) {
    return this.sendStoreMessage.execute({
      merchant_id: body.merchant_id,
      conversation_id: conversationId,
      user_message: body.user_message,
      cart_id: body.cart_id,
      history: body.history
    });
  }

  @Get("conversations/:conversationId")
  async getHistory(
    @Param("conversationId") conversationId: string,
    @Body() body: { merchant_id: string }
  ) {
    return this.getConversationHistory.execute({
      merchant_id: body.merchant_id,
      conversation_id: conversationId
    });
  }
}
