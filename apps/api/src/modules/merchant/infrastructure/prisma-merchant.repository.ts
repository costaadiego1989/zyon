import { Prisma, type PrismaClient } from "@prisma/client";
import type { StageQuickReplies } from "@zyon/shared-types";
import type { MerchantProfile, MerchantRules, MerchantStoreSettings, MerchantTheme } from "../domain/merchant.types.js";
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
      storeSettings: (row.storeSettings as MerchantStoreSettings) ?? undefined,
      stripeConnectAccountId: row.stripeConnectAccountId ?? undefined
    };
  }

  async getById(merchantId: string): Promise<any | null> {
    return this.prisma.merchant.findUnique({ where: { id: merchantId } });
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
    const row = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { storeSettings: true, name: true, users: { select: { email: true }, take: 1 } },
    });
    const stored = (row?.storeSettings as import("../domain/merchant.types.js").MerchantStoreSettings) ?? {};

    if (!stored.company?.razaoSocial && row?.name) {
      stored.company = { ...stored.company, razaoSocial: row.name };
    }
    if (!stored.company?.email && row?.users?.[0]?.email) {
      stored.company = { ...stored.company, email: row.users[0].email };
    }

    return stored;
  }

  async updateStoreSettings(merchantId: string, settings: import("../domain/merchant.types.js").MerchantStoreSettings): Promise<import("../domain/merchant.types.js").MerchantStoreSettings> {
    const current = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { storeSettings: true },
    });
    const existing = (current?.storeSettings as Record<string, unknown>) ?? {};
    const incoming = settings as unknown as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      const prev = existing[key];
      const bothPlainObjects =
        prev != null && typeof prev === "object" && !Array.isArray(prev) &&
        value != null && typeof value === "object" && !Array.isArray(value);
      merged[key] = bothPlainObjects
        ? { ...(prev as Record<string, unknown>), ...(value as Record<string, unknown>) }
        : value;
    }

    const updated = await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { storeSettings: merged as unknown as object }
    });
    return (updated.storeSettings as import("../domain/merchant.types.js").MerchantStoreSettings) ?? merged;
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

  async updateMelhorEnvioEnabled(merchantId: string, enabled: boolean): Promise<void> {
    await (this.prisma.merchant.update as any)({
      where: { id: merchantId },
      data: { melhorEnvioEnabled: enabled }
    });
  }

  async findBySlug(slug: string): Promise<MerchantProfile | undefined> {
    const normalized = slug?.trim().toLowerCase();
    if (!normalized) return undefined;

    const rows = await (this.prisma.merchant as any).findMany({
      where: { storeSettings: { not: Prisma.JsonNull } },
      select: { id: true, name: true, storeSettings: true }
    });
    for (const row of rows) {
      const settings = row.storeSettings as MerchantStoreSettings | null;
      const candidate = settings?.slug?.trim().toLowerCase();
      if (candidate === normalized) {
        return {
          id: row.id,
          name: row.name,
          storeSettings: settings ?? undefined,
        };
      }
    }
    return undefined;
  }

  async findByCustomDomain(host: string): Promise<MerchantProfile | undefined> {
    const normalized = host?.trim().toLowerCase();
    if (!normalized) return undefined;

    const link = await (this.prisma as any).merchantDomain?.findUnique?.({
      where: { domain: normalized }
    });
    if (!link || link.verified !== true) return undefined;

    const row = await this.prisma.merchant.findUnique({
      where: { id: link.merchantId }
    });
    if (!row) return undefined;

    return {
      id: row.id,
      name: row.name,
      storeSettings: (row.storeSettings as MerchantStoreSettings) ?? undefined,
    };
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
    autonomousEngineEnabled: rules.autonomousEngineEnabled ?? true,
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
  autonomousEngineEnabled?: boolean | null;
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
    autonomousEngineEnabled: row.autonomousEngineEnabled ?? true,
    originZip: row.originZip ?? undefined,
    quickReplies: row.quickReplies != null
      ? (row.quickReplies as unknown as StageQuickReplies)
      : undefined,
    cryptoPayments: row.cryptoPayments != null
      ? (row.cryptoPayments as MerchantRules["cryptoPayments"])
      : undefined,
  };
}
