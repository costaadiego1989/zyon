import { enqueueCanonicalPublicBusinessSources, enqueueOtherPublicSettingsSources, invalidateServiceBusinessPublicationWithin, publicServiceBusinessPublished } from "../../graph-rag/infrastructure/public-business-write.js";
import { NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { StageQuickReplies } from "@zyon/shared-types";
import type { MerchantProfile, MerchantRules, MerchantStoreSettings, MerchantTheme } from "../domain/merchant.types.js";
import type { MerchantRepository } from "../domain/ports/merchant-repository.port.js";
import type { MerchantRulesRepository } from "../domain/ports/merchant-rules.repository.port.js";
import { DEFAULT_RULES } from "../domain/merchant-rules.defaults.js";
import { decodePersistedTheme } from "../domain/services/merchant-theme.validators.js";
import { toNumber } from "../../../shared/persistence/decimal.util.js";
import { isBillingFeatureEnabled } from "../../payment/domain/billing-plans.js";
import { z } from "zod";
import { selectInitialBusinessMode } from "../application/initial-business-mode-selection.js";
import { mapMerchantBusinessProfile } from "../application/merchant-business-profile.mapper.js";
import { mapCompanySettings } from "../application/company-settings.mapper.js";
import { normalizeCompanySettingsPatch, mergeCompanySettingsPatch, enqueueCompanySettingsWork, assertCompanyServiceNamesMode } from "../application/company-settings-write.js";

const existingPercent = z.union([z.number().finite(), z.custom<Prisma.Decimal>(value => Prisma.Decimal.isDecimal(value))
  .transform(value => value.toNumber())]).pipe(z.number().finite().min(0).max(100));
const existingAuthority = z.object({ merchantId: z.string(), maxDiscountPercent: existingPercent,
  minimumMarginPercent: existingPercent });

/** Read-only existing-policy projection, reusable by transaction-bound callers.
 * Shares the exact mapper; never provisions defaults or owns a transaction. */
export async function readExistingPrismaMerchantRules(prisma: Pick<Prisma.TransactionClient, "merchantRule" | "merchant">, merchantId: string): Promise<MerchantRules | undefined> {
  const row = await prisma.merchantRule.findUnique({ where: { merchantId } });
  if (row === null) return undefined;
  const authority = existingAuthority.safeParse(row);
  if (!authority.success || authority.data.merchantId !== merchantId) return undefined;
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { storeSettings: true } });
  return { ...toRules(row), policies: (merchant?.storeSettings as MerchantStoreSettings | null)?.checkoutPolicyLinks };
}

import { serviceActivationReadinessWithin } from "../../../shared/bookings/service-activation-readiness.js";

export class PrismaMerchantRepository implements MerchantRepository, MerchantRulesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getProfile(merchantId: string): Promise<MerchantProfile | undefined> {
    const row = await this.prisma.merchant.findUnique({ where: { id: merchantId }, include: { serviceBusinessPolicy: true } });
    if (!row) return undefined;
    const hasLegacyServiceData = !row.businessModeSelectedAt && (
      await this.prisma.product.count({ where: { merchantId, type: "service" } }) > 0 ||
      await this.prisma.serviceReservation.count({ where: { merchantId } }) > 0
    );
    const activation = row.businessMode === "services" ? await this.prisma.$transaction(tx => serviceActivationReadinessWithin(tx, merchantId), { isolationLevel: "RepeatableRead" }) : undefined;
    const business = mapMerchantBusinessProfile({ businessMode: row.businessMode, businessModeSelectedAt: row.businessModeSelectedAt,
      businessModeNeedsReview: row.businessModeNeedsReview, hasLegacyServiceData, policy: row.serviceBusinessPolicy });
    const activationMatches = !activation || activation.ready && activation.policyVersion === business.policyVersion;
    return {
      ...business,
      ...(!activationMatches && business.capabilities.serviceBooking ? {
        capabilities: { ...business.capabilities, serviceBooking: false }, bookingBlockReason: "service_activation_not_ready",
      } : {}),
      id: row.id,
      budgetModeEnabled: row.budgetModeEnabled,
      name: row.name,
      theme: decodePersistedTheme(row.theme),
      storeCategory: row.storeCategory ?? undefined,
      plan: row.plan,
      storeSettings: { ...((row.storeSettings as MerchantStoreSettings) ?? {}), ...(row.storeSlug ? { slug: row.storeSlug } : {}) },
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
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      await tx.merchant.update({ where: { id: merchantId }, data: { storeCategory } });
      await enqueueCanonicalPublicBusinessSources(tx, merchantId, [{ sourceType: "company", sourceId: merchantId }]);
    });
  }

  async getStoreSettings(merchantId: string): Promise<import("../domain/merchant.types.js").MerchantStoreSettings> {
    const row = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { businessMode: true, storeSettings: true, name: true, budgetModeEnabled: true, budgetEmail: true, budgetWhatsapp: true },
    });
    const stored = (row?.storeSettings ?? {}) as MerchantStoreSettings;
    return { ...stored, company: mapCompanySettings(stored.company, row?.name, row?.businessMode),
      budget: { enabled: row?.budgetModeEnabled ?? false, email: row?.budgetEmail ?? "", whatsapp: row?.budgetWhatsapp ?? "" } };
  }

  async updateStoreSettings(merchantId: string, settings: MerchantStoreSettings): Promise<MerchantStoreSettings> {
    const incoming = normalizeCompanySettingsPatch(settings);
    const policyPatch = settings.policies && Object.fromEntries(Object.entries(settings.policies).filter(([, value]) => value !== undefined));
    if (policyPatch) incoming.policies = policyPatch;
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      const current = await tx.merchant.findUnique({ where: { id: merchantId }, select: { storeSettings: true, businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
      if (!current) throw new NotFoundException("merchant_not_found");
      const { budget: _budget, ...storedPatch } = incoming;
      const merged = mergeCompanySettingsPatch(current.storeSettings, storedPatch);
      const requestedSlug = typeof merged.slug === "string" ? merged.slug.trim().toLowerCase() : undefined;
      await selectInitialBusinessMode(tx, merchantId, incoming);
      const selected = await tx.merchant.findUnique({ where: { id: merchantId }, select: { businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
      if (!selected) throw new NotFoundException("merchant_not_found");
      assertCompanyServiceNamesMode(incoming, selected.businessMode);
      await tx.merchant.update({ where: { id: merchantId }, data: {
        ...(settings.budget ? {
          budgetModeEnabled: settings.budget.enabled,
          ...(settings.budget.email !== undefined ? { budgetEmail: settings.budget.email || null } : {}),
          ...(settings.budget.whatsapp !== undefined ? { budgetWhatsapp: settings.budget.whatsapp || null } : {}),
        } : {}),
        storeSettings: merged as Prisma.InputJsonObject,
        ...(requestedSlug ? { storeSlug: requestedSlug } : {}),
      } });
      if (policyPatch) {
        const commercial = Object.fromEntries(["returns", "shipping", "warranty", "payment", "general"].filter(field => Object.hasOwn(policyPatch, field)).map(field => [field, policyPatch[field] || null]));
        if (Object.keys(commercial).length) await tx.merchantPolicy.upsert({
          where: { merchantId }, create: { merchantId, ...commercial }, update: commercial,
        });
        // Preserve live retrieval invalidation as well as canonical public work.
        await tx.knowledgeChunk.deleteMany({ where: { merchantId, sourceType: "policy", sourceId: { in: Object.keys(policyPatch) } } });
      }
      await enqueueCompanySettingsWork(tx, merchantId, current.storeSettings, merged, current.businessMode, selected.businessMode);
      await enqueueOtherPublicSettingsSources(tx, merchantId, incoming);
      if (publicServiceBusinessPublished(current) !== publicServiceBusinessPublished(selected)) await invalidateServiceBusinessPublicationWithin(tx, merchantId);
    });
    return this.getStoreSettings(merchantId);
  }

  async getRules(merchantId: string): Promise<MerchantRules> {
    const row = await this.prisma.merchantRule.upsert({
      where: { merchantId },
      create: toCreate(merchantId, DEFAULT_RULES),
      update: {}
    });
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { storeSettings: true } });
    return { ...toRules(row), policies: (merchant?.storeSettings as MerchantStoreSettings | null)?.checkoutPolicyLinks };
  }

  async getExistingRules(merchantId: string): Promise<MerchantRules | undefined> {
    return readExistingPrismaMerchantRules(this.prisma, merchantId);
  }

  async updateRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    const current = await this.getRules(merchantId);
    const defined = (obj: Record<string, unknown>) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
    const next = { ...DEFAULT_RULES, ...defined(current as unknown as Record<string, unknown>), ...defined(rules as unknown as Record<string, unknown>) } as MerchantRules;
    const update = { where: { merchantId }, create: toCreate(merchantId, next), update: toUpdate(next) };
    if (rules.policies !== undefined) {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
        const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: { storeSettings: true } });
        const stored = (merchant?.storeSettings as MerchantStoreSettings | null) ?? {};
        next.policies = { ...stored.checkoutPolicyLinks, ...rules.policies };
        await tx.merchant.update({ where: { id: merchantId }, data: {
          storeSettings: { ...stored, checkoutPolicyLinks: next.policies } as unknown as Prisma.InputJsonValue,
        } });
        await enqueueOtherPublicSettingsSources(tx, merchantId, { checkoutPolicyLinks: rules.policies });
        return tx.merchantRule.upsert(update);
      });
      return { ...toRules(row), policies: next.policies };
    }
    return { ...toRules(await this.prisma.merchantRule.upsert(update)), policies: current.policies };
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

    const row = await this.prisma.merchant.findUnique({ where: { storeSlug: normalized } });
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      storeSettings: { ...((row.storeSettings as MerchantStoreSettings) ?? {}), slug: row.storeSlug! },
    };
  }

  async findByCustomDomain(host: string): Promise<MerchantProfile | undefined> {
    const normalized = host?.trim().toLowerCase();
    if (!normalized) return undefined;

    const link = await (this.prisma as any).merchantDomain?.findUnique?.({
      where: { domain: normalized }
    });
    if (!link || link.verified !== true || !link.ownershipVerifiedAt) return undefined;
    const subscription = await this.prisma.merchantBillingSubscription.findUnique({
      where: { merchantId: link.merchantId },
      select: { status: true, trialEndsAt: true, stripePriceId: true, planKey: true },
    });
    if (!isBillingFeatureEnabled(subscription, "customDomain")) return undefined;

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

  async listPublicStores(): Promise<Array<{ slug: string; updatedAt: string }>> {
    const rows = await this.prisma.merchant.findMany({
      where: { plan: { in: ["STORE_ONLY", "BOTH"] }, storeSlug: { not: null } },
      select: { storeSlug: true, updatedAt: true },
    });
    return rows.map((row) => ({ slug: row.storeSlug!, updatedAt: row.updatedAt.toISOString() }));
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
