import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";
import {
  BUYER_EARNED_BENEFIT_REPOSITORY,
  type BuyerEarnedBenefitRepositoryPort,
} from "../../domain/ports/buyer-earned-benefit.repository.port.js";
import {
  AdvancedRuleEvaluator,
  type AdvancedRule,
  type RuleMatchContext,
} from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";

export interface BuyerBenefitCartContext {
  cartTotal?: number;
  shippingCost?: number;
  cartItemCount?: number;
  skusInCart?: string[];
  categoriesInCart?: string[];
  couponApplied?: boolean;
  paymentMethod?: string;
}

export interface GetBuyerBenefitsInput {
  globalUserId: string;
  /** Tenant boundary (INV-06). When absent, consent may resolve any merchant for this buyer. */
  merchantId?: string;
  /** Optional last-cart snapshot used to qualify available rules and compute progress. */
  cart?: BuyerBenefitCartContext;
}

export interface AvailableBenefitDto {
  description: string;
  ruleId: string;
  discountPercent?: number;
  maxReais?: number;
  condition: string;
}

export interface EarnedBenefitDto {
  description: string;
  value: number;
  origin: string;
  expiresAt?: string;
}

export interface ProgressBenefitDto {
  description: string;
  current: number;
  target: number;
  remaining: number;
}

export interface BuyerBenefitsResult {
  available: AvailableBenefitDto[];
  earned: EarnedBenefitDto[];
  progress: ProgressBenefitDto[];
}

const VALUE_ACTIONS = new Set(["offer_discount", "offer_free_shipping", "offer_coupon"]);

@Injectable()
export class GetBuyerBenefitsUseCase {
  private readonly evaluator = new AdvancedRuleEvaluator();

  constructor(
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(BUYER_EARNED_BENEFIT_REPOSITORY)
    private readonly benefits: BuyerEarnedBenefitRepositoryPort
  ) {}

  async execute(input: GetBuyerBenefitsInput): Promise<BuyerBenefitsResult> {
    const empty: BuyerBenefitsResult = { available: [], earned: [], progress: [] };
    const { globalUserId } = input;
    if (!globalUserId) return empty;

    // Consent gate (INV-05): benefits are intent/behaviour-derived data. Without an
    // active opted-in consent row we return nothing derived from the buyer profile.
    const now = new Date();
    const consent = await (this.prisma as any).buyerIntentMemoryConsent.findFirst({
      where: {
        globalUserId,
        ...(input.merchantId ? { merchantId: input.merchantId } : {}),
        optedIn: true,
        expiresAt: { gt: now },
      },
    });
    if (!consent) return empty;

    // Tenant boundary (INV-06): scope everything to the consented merchant.
    const merchantId: string = input.merchantId ?? consent.merchantId;

    const [earned, available, progress] = await Promise.all([
      this.buildEarned(merchantId, globalUserId),
      this.buildAvailable(merchantId, input.cart),
      this.buildProgress(merchantId, input.cart),
    ]);

    return { available, earned, progress };
  }

  private async buildEarned(
    merchantId: string,
    globalUserId: string
  ): Promise<EarnedBenefitDto[]> {
    const rows = await this.benefits.listActive(merchantId, globalUserId);
    return rows.map((b) => ({
      description: b.reason,
      value: b.value,
      origin: b.origin,
      ...(b.expiresAt ? { expiresAt: b.expiresAt } : {}),
    }));
  }

  private async buildAvailable(
    merchantId: string,
    cart?: BuyerBenefitCartContext
  ): Promise<AvailableBenefitDto[]> {
    const rules = await this.loadAdvancedRules(merchantId);
    if (rules.length === 0) return [];

    const ctx = this.toMatchContext(cart);
    const out: AvailableBenefitDto[] = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!VALUE_ACTIONS.has(rule.action?.type)) continue;
      if (!this.evaluator.wouldMatch(rule, ctx)) continue;

      const params = rule.action.params ?? {};
      const discountPercent =
        typeof params.percent === "number" ? params.percent : undefined;
      const maxReais =
        typeof params.maxDiscountReais === "number" ? params.maxDiscountReais : undefined;

      out.push({
        ruleId: rule.id ?? "",
        description: describeAction(rule.action.type, discountPercent),
        ...(discountPercent !== undefined ? { discountPercent } : {}),
        ...(maxReais !== undefined ? { maxReais } : {}),
        condition: describeConditions(rule),
      });
    }

    return out;
  }

  private async buildProgress(
    merchantId: string,
    cart?: BuyerBenefitCartContext
  ): Promise<ProgressBenefitDto[]> {
    const cartTotal = cart?.cartTotal ?? 0;
    const rules = await (this.prisma as any).merchantRule.findFirst({
      where: { merchantId },
      select: { freeShippingMinCartValue: true, allowFreeShipping: true },
    });
    if (!rules || rules.allowFreeShipping === false) return [];

    const target = Number(rules.freeShippingMinCartValue);
    if (!Number.isFinite(target) || target <= 0) return [];
    if (cartTotal >= target) return [];

    const remaining = round2(target - cartTotal);
    return [
      {
        description: `Faltam R$${remaining.toFixed(2)} para frete grátis`,
        current: round2(cartTotal),
        target: round2(target),
        remaining,
      },
    ];
  }

  private async loadAdvancedRules(merchantId: string): Promise<AdvancedRule[]> {
    const setting = await (this.prisma as any).checkoutSetting.findUnique({
      where: { merchantId },
      select: { advancedRules: true },
    });
    const raw = setting?.advancedRules;
    return Array.isArray(raw) ? (raw as AdvancedRule[]) : [];
  }

  private toMatchContext(cart?: BuyerBenefitCartContext): RuleMatchContext {
    return {
      cartTotal: cart?.cartTotal ?? 0,
      shippingCost: cart?.shippingCost ?? 0,
      cartItemCount: cart?.cartItemCount ?? 0,
      skusInCart: cart?.skusInCart ?? [],
      categoriesInCart: cart?.categoriesInCart ?? [],
      couponApplied: cart?.couponApplied ?? false,
      buyerType: "returning",
      paymentMethod: cart?.paymentMethod,
    };
  }
}

function describeAction(type: string, percent?: number): string {
  switch (type) {
    case "offer_discount":
      return percent !== undefined
        ? `Desconto de ${percent}% disponível`
        : "Desconto disponível";
    case "offer_free_shipping":
      return "Frete grátis disponível";
    case "offer_coupon":
      return "Cupom disponível";
    default:
      return "Benefício disponível";
  }
}

function describeConditions(rule: AdvancedRule): string {
  if (!rule.conditions || rule.conditions.length === 0) return "sempre";
  return rule.conditions
    .map((c) => `${c.field} ${c.operator} ${String(c.value)}`)
    .join(" e ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
