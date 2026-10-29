import { Controller, Delete, Get, Inject, Req, UseGuards } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";

@Controller("buyer/consent/intent-memory")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerPrivacyController {
  constructor(@Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  private scope(request: { user?: unknown }) {
    const buyer = currentBuyer(request);
    return { globalUserId: buyer.globalUserId, ...(buyer.merchantId ? { merchantId: buyer.merchantId } : {}) };
  }

  @Get()
  async get(@Req() request: { user?: unknown }) {
    const where = this.scope(request);
    const now = new Date();
    const [consents, record] = await Promise.all([
      this.prisma.buyerIntentMemoryConsent.findMany({ where, select: { optedIn: true, expiresAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" } }),
      this.prisma.customerIntentRecord.findFirst({ where, orderBy: { generatedAt: "desc" }, select: { primaryIntent: true, categoryFocus: true, budgetTier: true } }),
    ]);
    const active = consents.find(consent => consent.optedIn && consent.expiresAt > now);
    return { has_consent: Boolean(active), has_data: Boolean(record) || consents.length > 0,
      consented_at: active?.updatedAt.toISOString(), primary_intent: record?.primaryIntent,
      category_focus: record?.categoryFocus, budget_tier: record?.budgetTier };
  }

  @Delete()
  async remove(@Req() request: { user?: unknown }) {
    const where = this.scope(request);
    await this.prisma.$transaction(async tx => {
      await tx.customerIntentRecord.deleteMany({ where });
      await tx.buyerIntentMemoryConsent.deleteMany({ where });
    });
    return { success: true };
  }
}
