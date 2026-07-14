import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ListBuyerConversationsUseCase } from "../../application/use-cases/buyer-conversation.use-cases.js";
import { GetBuyerConversationUseCase } from "../../application/use-cases/buyer-conversation.use-cases.js";
import { RateBuyerConversationMessageUseCase } from "../../application/use-cases/buyer-conversation.use-cases.js";
import { DeleteBuyerAccountUseCase } from "../../application/use-cases/delete-buyer-account.use-case.js";
import { ExportBuyerDataUseCase } from "../../application/use-cases/export-buyer-data.use-case.js";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";
import type { BuyerConversation } from "../../domain/ports/buyer-conversation.port.js";

function conversationToDto(c: BuyerConversation) {
  return {
    id: c.id,
    session_id: c.sessionId,
    merchant_id: c.merchantId,
    started_at: c.startedAt.toISOString(),
    last_message_at: c.lastMessageAt.toISOString(),
    messages: c.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.createdAt.toISOString(),
      rating: m.rating,
    })),
  };
}

@Controller("buyer/me")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerHubController {
  constructor(
    private readonly listConversationsUC: ListBuyerConversationsUseCase,
    private readonly getConversationUC: GetBuyerConversationUseCase,
    private readonly rateMessage: RateBuyerConversationMessageUseCase,
    private readonly deleteAccountUC: DeleteBuyerAccountUseCase,
    private readonly exportDataUC: ExportBuyerDataUseCase
  ) {}

  @Get("conversations")
  async listConversations(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    const list = await this.listConversationsUC.execute({ globalUserId: buyer.globalUserId });
    return {
      items: list.map(conversationToDto),
    };
  }

  @Get("conversations/:id")
  async getConversation(@Req() req: { user?: unknown }, @Param("id") id: string) {
    const buyer = currentBuyer(req);
    const c = await this.getConversationUC.execute({
      globalUserId: buyer.globalUserId,
      id,
    });
    return conversationToDto(c);
  }

  @Post("conversations/:id/rate")
  async rateConversationMessage(
    @Req() req: { user?: unknown },
    @Param("id") id: string,
    @Body() body: { message_id: string; rating: "up" | "down" }
  ) {
    const buyer = currentBuyer(req);
    await this.rateMessage.execute({
      globalUserId: buyer.globalUserId,
      conversationId: id,
      messageId: body.message_id,
      rating: body.rating,
    });
    return { success: true };
  }

  @Get("export")
  async exportData(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    return this.exportDataUC.execute({ globalUserId: buyer.globalUserId });
  }

  @Delete("account")
  async deleteAccount(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    const result = await this.deleteAccountUC.execute({ globalUserId: buyer.globalUserId });
    return {
      deleted: result.deleted,
      anonymized_purchases: result.anonymizedPurchases,
    };
  }
}
