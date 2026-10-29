import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ListBuyerConversationsUseCase } from "../../application/use-cases/buyer-conversation.use-cases.js";
import { GetBuyerConversationUseCase } from "../../application/use-cases/buyer-conversation.use-cases.js";
import { RateBuyerConversationMessageUseCase } from "../../application/use-cases/buyer-conversation.use-cases.js";
import { DeleteBuyerAccountUseCase } from "../../application/use-cases/delete-buyer-account.use-case.js";
import { ExportBuyerDataUseCase } from "../../application/use-cases/export-buyer-data.use-case.js";
import { GetBuyerBenefitsUseCase } from "../../application/use-cases/get-buyer-benefits.use-case.js";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";
import type { BuyerConversation } from "../../domain/ports/buyer-conversation.port.js";

function conversationToDto(c: BuyerConversation) {
  return {
    id: c.id,
    session_id: c.sessionId,
    merchant_id: c.merchantId,
    merchant_name: c.merchantName ?? null,
    status: c.status ?? "history",
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
    private readonly exportDataUC: ExportBuyerDataUseCase,
    private readonly getBenefitsUC: GetBuyerBenefitsUseCase
  ) {}

  @Get("benefits")
  @Header("Cache-Control", "private, no-store")
  async getBenefits(@Req() req: { user?: unknown }, @Query("merchant_id") merchantQuery?: unknown) {
    const buyer = currentBuyer(req);
    if (merchantQuery !== undefined && (typeof merchantQuery !== "string" || !merchantQuery.trim() || merchantQuery.length > 200)) {
      throw new BadRequestException("invalid_merchant_id");
    }
    const requestedMerchant = typeof merchantQuery === "string" ? merchantQuery.trim() : undefined;
    if (buyer.merchantId && requestedMerchant && buyer.merchantId !== requestedMerchant) {
      throw new ForbiddenException("buyer_merchant_mismatch");
    }
    return this.getBenefitsUC.execute({
      globalUserId: buyer.globalUserId,
      merchantId: buyer.merchantId ?? requestedMerchant,
    });
  }

  @Get("conversations")
  @Header("Cache-Control", "private, no-store")
  async listConversations(@Req() req: { user?: unknown }, @Query("merchant_id") merchantQuery?: unknown) {
    const buyer = currentBuyer(req);
    const merchantId = conversationMerchantScope(buyer.merchantId, merchantQuery);
    const list = await this.listConversationsUC.execute({ globalUserId: buyer.globalUserId, merchantId });
    return {
      items: list.map(conversationToDto),
    };
  }

  @Get("conversations/:id")
  @Header("Cache-Control", "private, no-store")
  async getConversation(@Req() req: { user?: unknown }, @Param("id") id: string, @Query("merchant_id") merchantQuery?: unknown) {
    const buyer = currentBuyer(req);
    const c = await this.getConversationUC.execute({
      globalUserId: buyer.globalUserId,
      id,
      merchantId: conversationMerchantScope(buyer.merchantId, merchantQuery),
    });
    return conversationToDto(c);
  }

  @Post("conversations/:id/rate")
  async rateConversationMessage(
    @Req() req: { user?: unknown },
    @Param("id") id: string,
    @Body() body: { message_id: string; rating: "up" | "down" },
    @Query("merchant_id") merchantQuery?: unknown,
  ) {
    const buyer = currentBuyer(req);
    await this.rateMessage.execute({
      globalUserId: buyer.globalUserId,
      conversationId: id,
      messageId: body.message_id,
      rating: body.rating,
      merchantId: conversationMerchantScope(buyer.merchantId, merchantQuery),
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

function conversationMerchantScope(tokenMerchant: string | undefined, query: unknown): string | undefined {
  if (query !== undefined && (typeof query !== "string" || !query.trim() || query.length > 200)) throw new BadRequestException("invalid_merchant_id");
  const requested = typeof query === "string" ? query.trim() : undefined;
  if (tokenMerchant && requested && tokenMerchant !== requested) throw new ForbiddenException("buyer_merchant_mismatch");
  return tokenMerchant ?? requested;
}
