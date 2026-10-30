import type { PrismaClient } from "@prisma/client";
import type { CrossSellSuggestionEntity } from "../../domain/entities/cross-sell-suggestion.entity.js";
import type { CrossSellSuggestionRepository } from "../../domain/ports/cross-sell-suggestion-repository.port.js";
import { toSuggestionCreateInput, toSuggestionEntity, toSuggestionUpdateInput } from "./prisma-cross-sell.converters.js";

/**
 * P0 fix: Prisma implementation of CrossSellSuggestionRepository.
 */
export class PrismaCrossSellSuggestionRepository implements CrossSellSuggestionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(suggestion: CrossSellSuggestionEntity): Promise<void> {
    await this.prisma.crossSellSuggestion.upsert({
      where: { id: suggestion.id },
      create: toSuggestionCreateInput(suggestion),
      update: toSuggestionUpdateInput(suggestion)
    });
  }

  async findById(id: string, merchantId: string): Promise<CrossSellSuggestionEntity | null> {
    const row = await this.prisma.crossSellSuggestion.findFirst({
      where: { id, merchantId }
    });
    return row ? toSuggestionEntity(row) : null;
  }

  async refreshPending(suggestion: CrossSellSuggestionEntity): Promise<boolean> {
    const snapshot = suggestion.snapshot();
    if (snapshot.status !== "pending") return false;
    const result = await this.prisma.crossSellSuggestion.updateMany({
      where: { id: snapshot.id, merchantId: snapshot.merchant_id, sessionId: snapshot.session_id, status: "pending" },
      data: { rankedItems: snapshot.ranked_items, computedDiscount: snapshot.computed_discount },
    });
    return result.count === 1;
  }

  async findBySession(sessionId: string, merchantId: string): Promise<CrossSellSuggestionEntity[]> {
    const rows = await this.prisma.crossSellSuggestion.findMany({
      where: { sessionId, merchantId },
      orderBy: { suggestedAt: "desc" }
    });
    return rows.map(toSuggestionEntity);
  }
}
