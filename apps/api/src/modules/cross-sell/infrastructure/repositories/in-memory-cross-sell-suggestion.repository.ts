import { Injectable } from "@nestjs/common";
import { CrossSellSuggestionEntity } from "../../domain/entities/cross-sell-suggestion.entity.js";
import type { CrossSellSuggestionRepository } from "../../domain/ports/cross-sell-suggestion-repository.port.js";

@Injectable()
export class InMemoryCrossSellSuggestionRepository implements CrossSellSuggestionRepository {
  private readonly store = new Map<string, CrossSellSuggestionEntity>();

  async save(suggestion: CrossSellSuggestionEntity): Promise<void> {
    this.store.set(suggestion.id, suggestion);
  }

  async findById(id: string, merchantId: string): Promise<CrossSellSuggestionEntity | null> {
    const s = this.store.get(id);
    if (!s || s.merchant_id !== merchantId) return null;
    return s;
  }

  async findBySession(sessionId: string, merchantId: string): Promise<CrossSellSuggestionEntity[]> {
    return [...this.store.values()].filter((s) => s.session_id === sessionId && s.merchant_id === merchantId);
  }
}
