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

  async refreshPending(suggestion: CrossSellSuggestionEntity): Promise<boolean> {
    const current = this.store.get(suggestion.id)?.snapshot();
    const next = suggestion.snapshot();
    if (!current || current.merchant_id !== next.merchant_id || current.session_id !== next.session_id
      || current.status !== "pending" || next.status !== "pending") return false;
    this.store.set(suggestion.id, CrossSellSuggestionEntity.rehydrate({ ...current,
      ranked_items: [...next.ranked_items], computed_discount: next.computed_discount }));
    return true;
  }

  async findBySession(sessionId: string, merchantId: string): Promise<CrossSellSuggestionEntity[]> {
    return [...this.store.values()].filter((s) => s.session_id === sessionId && s.merchant_id === merchantId);
  }
}
