import { Prisma, type PrismaClient } from "@prisma/client";
import type { StageQuickReplies } from "@zyon/shared-types";
import type { MerchantProfile, MerchantRules, MerchantTheme } from "../domain/merchant.types.js";
import type { MerchantRepository } from "../domain/ports/merchant-repository.port.js";
import type { MerchantRulesRepository } from "../domain/ports/merchant-rules.repository.port.js";
import { DEFAULT_RULES } from "../domain/merchant-rules.defaults.js";
import { decodePersistedTheme } from "../domain/services/merchant-theme.validators.js";
import { toNumber } from "../../../shared/persistence/decimal.util.js";

export class PrismaMerchantRepository implements MerchantRepository, MerchantRulesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getProfile(merchantId: string): Promise<MerchantProfile | undefined> {
    const row = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      theme: decodePersistedTheme(row.theme),
      storeCategory: row.storeCategory ?? undefined,
      plan: row.plan,
      stripeConnectAccountId: row.stripeConnectAccountId ?? undefined
    };
  }

  async getStripeConnectAccountId(merchantId: string): Promise<string | undefined> {
    const row = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { stripeConnectAccountId: true }
    });
    return row?.stripeConnectAccountId?.trim() || undefined;
  }

  async setStripeConnectAccountId(merchantId: string, accountId: string): Promise<void> {
    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { stripeConnectAccountId: accountId }
    });
  }

  async updateTheme(merchantId: string, theme: MerchantTheme): Promise<MerchantTheme> {
    const updated = await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { theme: theme as unknown as object }
    });
    return ((updated.theme as MerchantTheme | null) ?? theme);
  }

  async updateStoreCategory(merchantId: string, storeCategory: string): Promise<void> {
    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { storeCategory }
    });
  }

  async getStoreSettings(merchantId: string): Promise<import("../domain/merchant.types.js").MerchantStoreSettings> {
    const row = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { storeSettings: true } });
    return (row?.storeSettings as import("../domain/merchant.types.js").MerchantStoreSettings) ?? {};
  }

  async updateStoreSettings(merchantId: string, settings: import("../domain/merchant.types.js").MerchantStoreSettings): Promise<import("../domain/merchant.types.js").MerchantStoreSettings> {
    const updated = await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { storeSettings: settings as unknown as object }
    });
    return (updated.storeSettings as import("../domain/merchant.types.js").MerchantStoreSettings) ?? settings;
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
    const current = await this.getRules(merchantId).catch(() => DEFAULT_RULES);
    const defined = (obj: Record<string, unknown>) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
    const next = { ...DEFAULT_RULES, ...defined(current as unknown as Record<string, unknown>), ...defined(rules as unknown as Record<string, unknown>) } as MerchantRules;
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
    maxDiscountPercent: rules.maxDiscountPercent ?? 10,
    minimumMarginPercent: rules.minimumMarginPercent ?? 38,
    allowFreeShipping: rules.allowFreeShipping ?? true,
    allowShippingDiscount: rules.allowShippingDiscount ?? true,
    allowBonusItem: rules.allowBonusItem ?? false,
    allowStackDiscountAndFreeShipping: rules.allowStackDiscountAndFreeShipping ?? false,
    couponBoxEnabled: rules.couponBoxEnabled ?? true,
    freeShippingMinCartValue: rules.freeShippingMinCartValue ?? 250,
    maxShippingSubsidy: rules.maxShippingSubsidy ?? 45,
    maxPartialShippingDiscount: rules.maxPartialShippingDiscount ?? 20,
    offerExpirationMinutes: rules.offerExpirationMinutes ?? 15,
    blockedRegions: rules.blockedRegions ?? [],
    brandVoice: rules.brandVoice ?? "consultative",
    originZip: rules.originZip ?? null,
    quickReplies: rules.quickReplies != null
      ? (rules.quickReplies as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    cryptoPayments: rules.cryptoPayments != null
      ? (rules.cryptoPayments as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull,
  };
}

type DecimalLike = { toNumber(): number } | number;

function toRules(row: {
  maxDiscountPercent: DecimalLike;
  minimumMarginPercent: DecimalLike;
  allowFreeShipping: boolean;
  allowShippingDiscount: boolean;
  allowBonusItem: boolean;
  allowStackDiscountAndFreeShipping: boolean;
  freeShippingMinCartValue: DecimalLike;
  maxShippingSubsidy: DecimalLike;
  maxPartialShippingDiscount: DecimalLike;
  offerExpirationMinutes: number;
  blockedRegions: string[];
  brandVoice: string;
  couponBoxEnabled?: boolean | null;
  originZip?: string | null;
  quickReplies?: unknown;
  cryptoPayments?: unknown;
}): MerchantRules {
  return {
    maxDiscountPercent: toNumber(row.maxDiscountPercent),
    minimumMarginPercent: toNumber(row.minimumMarginPercent),
    allowFreeShipping: row.allowFreeShipping,
    allowShippingDiscount: row.allowShippingDiscount,
    allowBonusItem: row.allowBonusItem,
    allowStackDiscountAndFreeShipping: row.allowStackDiscountAndFreeShipping,
    freeShippingMinCartValue: toNumber(row.freeShippingMinCartValue),
    maxShippingSubsidy: toNumber(row.maxShippingSubsidy),
    maxPartialShippingDiscount: toNumber(row.maxPartialShippingDiscount),
    offerExpirationMinutes: row.offerExpirationMinutes,
    blockedRegions: row.blockedRegions,
    brandVoice: row.brandVoice as MerchantRules["brandVoice"],
    couponBoxEnabled: row.couponBoxEnabled ?? true,
    originZip: row.originZip ?? undefined,
    quickReplies: row.quickReplies != null
      ? (row.quickReplies as unknown as StageQuickReplies)
      : undefined,
    cryptoPayments: row.cryptoPayments != null
      ? (row.cryptoPayments as MerchantRules["cryptoPayments"])
      : undefined,
  };
}
