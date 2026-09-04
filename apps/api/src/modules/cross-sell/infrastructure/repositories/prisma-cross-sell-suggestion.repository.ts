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

  async findBySession(sessionId: string, merchantId: string): Promise<CrossSellSuggestionEntity[]> {
    const rows = await this.prisma.crossSellSuggestion.findMany({
      where: { sessionId, merchantId },
      orderBy: { suggestedAt: "desc" }
    });
    return rows.map(toSuggestionEntity);
  }
}
