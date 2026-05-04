import type { PrismaClient } from "@prisma/client";
import type { MerchantProfile, MerchantRules, MerchantTheme } from "../domain/merchant.types.js";
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

export class PrismaMerchantRepository implements MerchantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getProfile(merchantId: string): Promise<MerchantProfile | undefined> {
    const row = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      theme: (row.theme ?? undefined) as MerchantTheme | undefined
    };
  }

  async updateTheme(merchantId: string, theme: MerchantTheme): Promise<MerchantTheme> {
    const updated = await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { theme: theme as unknown as object }
    });
    return ((updated.theme as MerchantTheme | null) ?? theme);
  }

  async getRules(merchantId: string): Promise<MerchantRules> {
    const row = await this.prisma.merchantRule.upsert({
      where: { merchantId },
      create: toCreate(merchantId, DEFAULT_RULES),
      update: {}
    });
    return toRules(row);
  }

  async updateRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    const current = await this.getRules(merchantId);
    const next = { ...current, ...rules };
    const row = await this.prisma.merchantRule.upsert({
      where: { merchantId },
      create: toCreate(merchantId, next),
      update: toUpdate(next)
    });
    return toRules(row);
  }
}

function toCreate(merchantId: string, rules: MerchantRules) {
  return { merchantId, ...toUpdate(rules) };
}

function toUpdate(rules: MerchantRules) {
  return {
    maxDiscountPercent: rules.maxDiscountPercent,
    minimumMarginPercent: rules.minimumMarginPercent,
    allowFreeShipping: rules.allowFreeShipping,
    allowShippingDiscount: rules.allowShippingDiscount,
    allowBonusItem: rules.allowBonusItem,
    allowStackDiscountAndFreeShipping: rules.allowStackDiscountAndFreeShipping,
    freeShippingMinCartValue: rules.freeShippingMinCartValue,
    maxShippingSubsidy: rules.maxShippingSubsidy,
    maxPartialShippingDiscount: rules.maxPartialShippingDiscount,
    offerExpirationMinutes: rules.offerExpirationMinutes,
    blockedRegions: rules.blockedRegions,
    brandVoice: rules.brandVoice
  };
}

function toRules(row: {
  maxDiscountPercent: number;
  minimumMarginPercent: number;
  allowFreeShipping: boolean;
  allowShippingDiscount: boolean;
  allowBonusItem: boolean;
  allowStackDiscountAndFreeShipping: boolean;
  freeShippingMinCartValue: number;
  maxShippingSubsidy: number;
  maxPartialShippingDiscount: number;
  offerExpirationMinutes: number;
  blockedRegions: string[];
  brandVoice: string;
}): MerchantRules {
  return {
    maxDiscountPercent: row.maxDiscountPercent,
    minimumMarginPercent: row.minimumMarginPercent,
    allowFreeShipping: row.allowFreeShipping,
    allowShippingDiscount: row.allowShippingDiscount,
    allowBonusItem: row.allowBonusItem,
    allowStackDiscountAndFreeShipping: row.allowStackDiscountAndFreeShipping,
    freeShippingMinCartValue: row.freeShippingMinCartValue,
    maxShippingSubsidy: row.maxShippingSubsidy,
    maxPartialShippingDiscount: row.maxPartialShippingDiscount,
    offerExpirationMinutes: row.offerExpirationMinutes,
    blockedRegions: row.blockedRegions,
    brandVoice: row.brandVoice as MerchantRules["brandVoice"]
  };
}
