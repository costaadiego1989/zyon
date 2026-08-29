import { Injectable, Inject, Optional, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort, type NudgeTrigger } from "../../domain/ports/conversation.port.js";
import { COUPON_REPOSITORY, type CouponRepository } from "../../../coupons/domain/ports/coupon-repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";

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
  ) {}

  async execute(input: GenerateNudgeInput): Promise<GenerateNudgeOutput> {
    const experimentSystemPrompt = await this.resolveExperimentPrompt(input.merchant_id);
    const agentTone = experimentSystemPrompt ? undefined : await this.resolveAgentTone(input.merchant_id);
    const availableOffers = await this.resolveAvailableOffers(input.merchant_id);

    const message = await this.conversation.generateNudge({
      merchantId: input.merchant_id,
      trigger: input.trigger,
      stage: input.stage,
      experimentSystemPrompt,
      agentTone,
      availableOffers,
      fallback: input.fallback,
    });

    return { message: message?.trim() || input.fallback };
  }

  private async resolveAvailableOffers(merchantId: string): Promise<string[]> {
    const offers: string[] = [];

    if (this.coupons) {
      try {
        const now = Date.now();
        const coupons = await this.coupons.findAllByMerchant(merchantId);
        for (const c of coupons) {
          const s = c.snapshot();
          if (s.status !== "active") continue;
          if (s.starts_at && new Date(s.starts_at).getTime() > now) continue;
          if (s.ends_at && new Date(s.ends_at).getTime() < now) continue;
          if (s.max_usages !== null && s.usages_count >= s.max_usages) continue;
          offers.push(this.describeCoupon(s));
        }
      } catch (err) {
        this.logger.warn(`[nudge] coupon lookup failed: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    try {
      const setting = await this.prisma.checkoutSetting.findUnique({
        where: { merchantId },
        select: { interventionPolicy: true },
      });
      const pd = (setting?.interventionPolicy as { progressiveDiscount?: { enabled?: boolean; maxProgressivePercent?: number } } | null)?.progressiveDiscount;
      if (pd?.enabled && (pd.maxProgressivePercent ?? 0) > 0) {
        offers.push(`desconto progressivo de até ${pd.maxProgressivePercent}% ao concluir a compra`);
      }
    } catch (err) {
      this.logger.warn(`[nudge] progressive lookup failed: ${err instanceof Error ? err.message : "unknown"}`);
    }

    if (this.merchants) {
      try {
        const rules = await this.merchants.getRules(merchantId);
        if (rules?.allowFreeShipping) {
          const min = Number(rules.freeShippingMinCartValue ?? 0);
          offers.push(min > 0 ? `frete grátis em compras acima de R$${min.toFixed(0)}` : "frete grátis");
        }
      } catch (err) {
        this.logger.warn(`[nudge] rules lookup failed: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    return offers;
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
