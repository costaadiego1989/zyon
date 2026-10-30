import type { CrossSellSuggestionEntity } from "../entities/cross-sell-suggestion.entity.js";

export const CROSS_SELL_SUGGESTION_REPOSITORY = Symbol("CROSS_SELL_SUGGESTION_REPOSITORY");

export interface CrossSellSuggestionRepository {
  save(suggestion: CrossSellSuggestionEntity): Promise<void>;
  /** Refresh offer data only while the same tenant/session suggestion is pending. */
  refreshPending(suggestion: CrossSellSuggestionEntity): Promise<boolean>;
  findById(id: string, merchantId: string): Promise<CrossSellSuggestionEntity | null>;
  findBySession(sessionId: string, merchantId: string): Promise<CrossSellSuggestionEntity[]>;
}
