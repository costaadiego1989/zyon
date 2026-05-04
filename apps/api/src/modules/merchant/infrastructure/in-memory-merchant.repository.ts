import { Injectable } from "@nestjs/common";
import type { MerchantProfile, MerchantRules } from "../domain/merchant.types.js";
import type { MerchantRepository } from "../domain/ports/merchant-repository.port.js";

const DEFAULT_RULES: MerchantRules = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 38,
  allowFreeShipping: true,
  allowShippingDiscount: true,
  allowBonusItem: false,
  allowStackDiscountAndFreeShipping: false,
  freeShippingMinCartValue: 250,
  maxShippingSubsidy: 45,
  maxPartialShippingDiscount: 20,
  offerExpirationMinutes: 15,
  blockedRegions: [],
  brandVoice: "consultative"
};

@Injectable()
export class InMemoryMerchantRepository implements MerchantRepository {
  private profiles = new Map<string, MerchantProfile>();
  private rules = new Map<string, MerchantRules>();

  seedProfile(profile: MerchantProfile): void {
    this.profiles.set(profile.id, profile);
  }

  async getProfile(merchantId: string): Promise<MerchantProfile | undefined> {
    return this.profiles.get(merchantId);
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
}
