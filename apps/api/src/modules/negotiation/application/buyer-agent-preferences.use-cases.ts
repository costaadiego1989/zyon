import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { BuyerNegotiationPreferences } from "@zyon/negotiation-engine";
import { DEFAULT_BUYER_NEGOTIATION_PREFERENCES } from "../domain/negotiation-defaults.js";
import { assertValidBuyerNegotiationPreferences } from "../domain/buyer-agent-preferences.entity.js";
import { NEGOTIATION_STORE, type NegotiationStore } from "../domain/ports/negotiation-store.port.js";

@Injectable()
export class GetBuyerAgentPreferencesUseCase {
  constructor(@Inject(NEGOTIATION_STORE) private readonly store: NegotiationStore) {}

  async executeResolved(input: {
    merchantId: string;
    globalUserId?: string;
  }): Promise<BuyerNegotiationPreferences> {
    if (!input.globalUserId?.trim()) {
      return DEFAULT_BUYER_NEGOTIATION_PREFERENCES;
    }
    const stored = await this.store.getBuyerPreferences(input.merchantId, input.globalUserId.trim());
    return stored ?? DEFAULT_BUYER_NEGOTIATION_PREFERENCES;
  }

  /** Raw stored row or null — useful for dashboard to know whether user has custom prefs. */
  async executeStored(input: {
    merchantId: string;
    globalUserId?: string;
  }): Promise<{ stored: BuyerNegotiationPreferences | null }> {
    if (!input.globalUserId?.trim()) {
      return { stored: null };
    }
    const row = await this.store.getBuyerPreferences(input.merchantId, input.globalUserId.trim());
    return { stored: row ?? null };
  }

  /**
   * Bug 8 fix: derive resolved preferences from an already-fetched stored value,
   * eliminating the duplicate DB read in GET endpoints.
   */
  resolvedFromStored(stored: BuyerNegotiationPreferences | null): BuyerNegotiationPreferences {
    return stored ?? DEFAULT_BUYER_NEGOTIATION_PREFERENCES;
  }

  async hasStoredPreferences(merchantId: string, globalUserId: string): Promise<boolean> {
    const stored = await this.store.getBuyerPreferences(merchantId, globalUserId);
    return stored !== null;
  }
}

@Injectable()
export class UpsertBuyerAgentPreferencesUseCase {
  constructor(@Inject(NEGOTIATION_STORE) private readonly store: NegotiationStore) {}

  async execute(input: {
    merchantId: string;
    globalUserId: string;
    preferences: BuyerNegotiationPreferences;
  }): Promise<BuyerNegotiationPreferences> {
    if (!input.globalUserId.trim()) {
      throw new BadRequestException("global_user_id_required_for_buyer_agent_preferences");
    }
    assertValidBuyerNegotiationPreferences(input.preferences);
    await this.store.upsertBuyerPreferences(
      input.merchantId,
      input.globalUserId.trim(),
      input.preferences
    );
    return input.preferences;
  }
}
