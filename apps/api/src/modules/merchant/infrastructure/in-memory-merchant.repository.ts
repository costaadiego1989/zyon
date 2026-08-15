import { Injectable } from "@nestjs/common";
import type { MerchantProfile, MerchantRules, MerchantTheme } from "../domain/merchant.types.js";
import type { MerchantRepository } from "../domain/ports/merchant-repository.port.js";
import type { MerchantRulesRepository } from "../domain/ports/merchant-rules.repository.port.js";
import { DEFAULT_RULES } from "../domain/merchant-rules.defaults.js";

@Injectable()
export class InMemoryMerchantRepository implements MerchantRepository, MerchantRulesRepository {
  private profiles = new Map<string, MerchantProfile>();
  private rules = new Map<string, MerchantRules>();
  private stripeAccounts = new Map<string, string>();

  seedProfile(profile: MerchantProfile): void {
    this.profiles.set(profile.id, profile);
    if (profile.stripeConnectAccountId) {
      this.stripeAccounts.set(profile.id, profile.stripeConnectAccountId);
    }
  }

  async getProfile(merchantId: string): Promise<MerchantProfile | undefined> {
    const profile = this.profiles.get(merchantId);
    if (!profile) return undefined;
    const stripeConnectAccountId = this.stripeAccounts.get(merchantId);
    const base = { ...profile, plan: profile.plan || "BOTH" };
    return stripeConnectAccountId ? { ...base, stripeConnectAccountId } : base;
  }

  async getStripeConnectAccountId(merchantId: string): Promise<string | undefined> {
    return this.stripeAccounts.get(merchantId) ?? this.profiles.get(merchantId)?.stripeConnectAccountId;
  }

  async setStripeConnectAccountId(merchantId: string, accountId: string): Promise<void> {
    this.stripeAccounts.set(merchantId, accountId);
    const existing = this.profiles.get(merchantId) ?? { id: merchantId, name: merchantId };
    this.profiles.set(merchantId, { ...existing, stripeConnectAccountId: accountId });
  }

  /**
   * Synchronous seed for test setup — avoids the microtask race that occurs
   * when the async `updateRules` is fire-and-forget'd in test helpers.
   */
  seedRules(merchantId: string, overrides: Partial<MerchantRules>): void {
    const base = this.rules.get(merchantId) ?? { ...DEFAULT_RULES };
    this.rules.set(merchantId, { ...base, ...overrides });
  }

  async getRules(merchantId: string): Promise<MerchantRules> {
    if (!this.rules.has(merchantId)) this.rules.set(merchantId, { ...DEFAULT_RULES });
    return this.rules.get(merchantId)!;
  }

  async updateRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    const next = { ...(await this.getRules(merchantId)), ...rules };
    this.rules.set(merchantId, next);
    return next;
  }

  async updateTheme(merchantId: string, theme: MerchantTheme): Promise<MerchantTheme> {
    const existing = this.profiles.get(merchantId) ?? { id: merchantId, name: merchantId };
    this.profiles.set(merchantId, { ...existing, theme });
    return theme;
  }

  async updateStoreCategory(merchantId: string, storeCategory: string): Promise<void> {
    const existing = this.profiles.get(merchantId) ?? { id: merchantId, name: merchantId };
    this.profiles.set(merchantId, { ...existing, storeCategory });
  }

  async getStoreSettings(_merchantId: string): Promise<import("../domain/merchant.types.js").MerchantStoreSettings> {
    return {};
  }

  async updateStoreSettings(_merchantId: string, settings: import("../domain/merchant.types.js").MerchantStoreSettings): Promise<import("../domain/merchant.types.js").MerchantStoreSettings> {
    return settings;
  }
}
