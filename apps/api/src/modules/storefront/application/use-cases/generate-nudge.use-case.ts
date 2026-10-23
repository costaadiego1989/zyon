import { Injectable, Inject, Optional, Logger, BadRequestException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort, type NudgeTrigger } from "../../domain/ports/conversation.port.js";
import { COUPON_REPOSITORY, type CouponRepository } from "../../../coupons/domain/ports/coupon-repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { generateNudgeInputSchema, nudgeCopyInputSchema, nudgePublicOutputSchema } from "../../domain/contracts/storefront-copy.schemas.js";
import { safeCopyFallback, validNudgePortMessage } from "../../domain/services/storefront-copy-policy.js";
import { NOOP_STOREFRONT_USE_CASE_OBSERVATION, STOREFRONT_USE_CASE_OBSERVATION, type StorefrontUseCaseObservation,
  type StorefrontObservationBoundary } from "../../domain/ports/storefront-use-case-observation.port.js";

export interface GenerateNudgeInput {
  merchant_id: string;
  trigger: NudgeTrigger;
  stage?: "cart" | "browsing";
  fallback: string;
}

export interface GenerateNudgeOutput {
  message: string;
}

@Injectable()
export class GenerateNudgeUseCase {
  private readonly logger = new Logger(GenerateNudgeUseCase.name);

  constructor(
    @Inject(STOREFRONT_CONVERSATION_PORT) private readonly conversation: StorefrontConversationPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() @Inject(COUPON_REPOSITORY) private readonly coupons?: CouponRepository,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchants?: MerchantRepository,
    @Optional() @Inject(STOREFRONT_USE_CASE_OBSERVATION) private readonly observation: StorefrontUseCaseObservation = NOOP_STOREFRONT_USE_CASE_OBSERVATION,
  ) {}

  async execute(input: GenerateNudgeInput): Promise<GenerateNudgeOutput> {
    return this.observation.turn(() => this.executeTurn(input));
  }

  private async executeTurn(input: GenerateNudgeInput): Promise<GenerateNudgeOutput> {
    const parsed = await this.validate("input", () => generateNudgeInputSchema.safeParse(input), "invalid_input");
    if (!parsed.success) throw new BadRequestException("invalid_storefront_nudge_input");
    input = parsed.data;
    const fallback = await this.observation.operation("validation", "fallback", async () => {
      const safe = safeCopyFallback(input.fallback);
      if (safe !== input.fallback) this.observation.decision("fallback", "fallback", "safety_rejected");
      return safe;
    });
    const experimentSystemPrompt = await this.resolveExperimentPrompt(input.merchant_id);
    const agentTone = experimentSystemPrompt ? undefined : await this.resolveAgentTone(input.merchant_id);
    const availableOffers = await this.resolveAvailableOffers(input.merchant_id);

    const context = await this.validate("context", () => nudgeCopyInputSchema.safeParse({
      merchantId: input.merchant_id,
      trigger: input.trigger,
      stage: input.stage,
      experimentSystemPrompt,
      agentTone,
      availableOffers,
      fallback,
    }), "invalid_context", "fallback");
    if (!context.success) {
      this.logger.warn({ event: "storefront_nudge_contract_invalid", stage: "context", schemaVersion: 1 });
      return this.publicResponse(fallback);
    }
    const trustedOffers = [...context.data.availableOffers];
    let boundary: StorefrontObservationBoundary = "generation";
    try {
      const generated = await this.observation.operation("generation", "generation", () => this.conversation.generateNudge(context.data));
      boundary = "output";
      const message = await this.observation.operation("validation", "output", async () => {
        const valid = validNudgePortMessage(generated, trustedOffers);
        if (valid === undefined) this.observation.decision("output", "fallback", "invalid_output");
        return valid ?? fallback;
      });
      boundary = "response";
      return await this.publicResponse(message);
    } catch {
      this.observation.decision(boundary, "fallback", "exception");
      this.logger.warn({ event: "storefront_nudge_generation_failed", schemaVersion: 1 });
      return this.publicResponse(fallback);
    }
  }

  private validate<T extends { success: boolean }>(boundary: StorefrontObservationBoundary, parse: () => T,
    reason: "invalid_input" | "invalid_context" | "invalid_output", outcome: "rejected" | "fallback" = "rejected"): Promise<T> {
    return this.observation.operation("validation", boundary, async () => {
      const parsed = parse();
      if (!parsed.success) this.observation.decision(boundary, outcome, reason);
      return parsed;
    });
  }

  private async publicResponse(message: string): Promise<GenerateNudgeOutput> {
    const response = await this.validate("response", () => nudgePublicOutputSchema.safeParse({ message }), "invalid_output");
    if (!response.success) throw response.error;
    return response.data;
  }

  private async resolveAvailableOffers(merchantId: string): Promise<string[]> {
    const offers: string[] = [];

    const maxDiscountPercent = await this.resolveMaxDiscount(merchantId);
    const progressive = await this.resolveProgressive(merchantId);

    const progressiveActive = progressive.enabled && progressive.maxPercent > 0;
    const cappedProgressive = Math.min(progressive.maxPercent, maxDiscountPercent);
    const couponsAllowed = !progressiveActive || progressive.mode === "coupon_only" || progressive.mode === "both";
    const progressiveAllowed = progressiveActive && progressive.mode !== "coupon_only";

    if (progressiveAllowed && cappedProgressive > 0) {
      offers.push(`desconto progressivo de até ${cappedProgressive}% ao concluir a compra`);
    }

    if (couponsAllowed && this.coupons) {
      try {
        const now = Date.now();
        const coupons = await this.coupons.findAllByMerchant(merchantId);
        for (const c of coupons) {
          const s = c.snapshot();
          if (s.strategy_incentive_execution_id != null) continue;
          if (s.status !== "active") continue;
          if (s.starts_at && new Date(s.starts_at).getTime() > now) continue;
          if (s.ends_at && new Date(s.ends_at).getTime() < now) continue;
          if (s.max_usages !== null && s.usages_count >= s.max_usages) continue;
          offers.push(this.describeCoupon(s));
        }
      } catch {
        this.logger.warn({ event: "storefront_nudge_lookup_failed", source: "coupons" });
      }
    }

    if (this.merchants) {
      try {
        const rules = await this.merchants.getRules(merchantId);
        if (rules?.allowFreeShipping) {
          const min = Number(rules.freeShippingMinCartValue ?? 0);
          offers.push(min > 0 ? `frete grátis em compras acima de R$${min.toFixed(0)}` : "frete grátis");
        }
      } catch {
        this.logger.warn({ event: "storefront_nudge_lookup_failed", source: "rules" });
      }
    }

    return offers;
  }

  private async resolveProgressive(merchantId: string): Promise<{ enabled: boolean; maxPercent: number; mode: string }> {
    try {
      const setting = await this.prisma.checkoutSetting.findUnique({
        where: { merchantId },
        select: { interventionPolicy: true },
      });
      const pd = (setting?.interventionPolicy as { progressiveDiscount?: { enabled?: boolean; maxProgressivePercent?: number; mode?: string } } | null)?.progressiveDiscount;
      return {
        enabled: Boolean(pd?.enabled),
        maxPercent: pd?.maxProgressivePercent ?? 0,
        mode: pd?.mode ?? "progressive_only",
      };
    } catch {
      return { enabled: false, maxPercent: 0, mode: "progressive_only" };
    }
  }

  private async resolveMaxDiscount(merchantId: string): Promise<number> {
    if (!this.merchants) return 100;
    try {
      const rules = await this.merchants.getRules(merchantId);
      const max = Number(rules?.maxDiscountPercent ?? 0);
      return max > 0 ? max : 100;
    } catch {
      return 100;
    }
  }

  private describeCoupon(s: { code: string; discount_type: string; discount_value: number; min_cart_total: number | null }): string {
    const min = s.min_cart_total && s.min_cart_total > 0 ? ` (em compras acima de R$${s.min_cart_total.toFixed(0)})` : "";
    switch (s.discount_type) {
      case "percent":
        return `cupom ${s.code} com ${s.discount_value}% de desconto${min}`;
      case "fixed":
        return `cupom ${s.code} com R$${s.discount_value.toFixed(0)} de desconto${min}`;
      case "shipping_free":
        return `cupom ${s.code} de frete grátis${min}`;
      case "shipping_percent":
        return `cupom ${s.code} com ${s.discount_value}% de desconto no frete${min}`;
      case "shipping_fixed":
        return `cupom ${s.code} com R$${s.discount_value.toFixed(0)} de desconto no frete${min}`;
      default:
        return `cupom ${s.code}`;
    }
  }

  private async resolveExperimentPrompt(merchantId: string): Promise<string | undefined> {
    try {
      const running = await this.prisma.promptExperiment.findFirst({
        where: { merchantId, status: "running" },
        include: { variants: true },
      });
      if (!running || running.variants.length === 0) return undefined;
      const total = running.variants.reduce((sum, v) => sum + v.weight, 0);
      let target = Math.floor(Math.random() * total);
      for (const variant of running.variants) {
        target -= variant.weight;
        if (target < 0) return variant.systemPrompt;
      }
      return running.variants[0].systemPrompt;
    } catch {
      return undefined;
    }
  }

  private async resolveAgentTone(merchantId: string): Promise<string | undefined> {
    try {
      const rule = await this.prisma.agentRule.findFirst({ where: { merchantId }, select: { identity: true } });
      const identity = rule?.identity as { tone?: string; persona?: string } | null;
      return identity?.persona || identity?.tone || undefined;
    } catch {
      return undefined;
    }
  }
}
