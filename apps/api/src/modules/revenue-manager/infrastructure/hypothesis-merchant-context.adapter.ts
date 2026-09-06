import type { PrismaClient } from "@prisma/client";
import type { MerchantRules } from "@zyon/shared-types";
import type { HypothesisMerchantContextPort } from "../domain/ports/hypothesis-merchant-context.port.js";

/** Unlike MerchantRulesRepository.getRules, this ACL never creates permissive defaults. */
export class PrismaHypothesisMerchantContext implements HypothesisMerchantContextPort {
  constructor(private readonly prisma: PrismaClient) {}

  async getRules(merchantId: string): Promise<MerchantRules | undefined> {
    const row = await this.prisma.merchantRule.findUnique({ where: { merchantId } });
    if (!row) return undefined;
    return {
      maxDiscountPercent: Number(row.maxDiscountPercent),
      minimumMarginPercent: Number(row.minimumMarginPercent),
      allowFreeShipping: row.allowFreeShipping,
      allowShippingDiscount: row.allowShippingDiscount,
      allowBonusItem: row.allowBonusItem,
      allowStackDiscountAndFreeShipping: row.allowStackDiscountAndFreeShipping,
      freeShippingMinCartValue: Number(row.freeShippingMinCartValue),
      maxShippingSubsidy: Number(row.maxShippingSubsidy),
      maxPartialShippingDiscount: Number(row.maxPartialShippingDiscount),
      offerExpirationMinutes: row.offerExpirationMinutes,
      blockedRegions: row.blockedRegions,
      brandVoice: row.brandVoice as MerchantRules["brandVoice"],
      couponBoxEnabled: row.couponBoxEnabled,
      autonomousEngineEnabled: row.autonomousEngineEnabled,
    };
  }

  async getCurrentPrompt(_merchantId: string): Promise<string | undefined> {
    // Checkout composes baseline behavior from its engine, session and agent context.
    // AgentRules stores structured identity/guardrails, not an active system prompt.
    // Neither an old experiment nor an LLM-written summary reproduces that baseline.
    // MI-11: block until checkout exposes a versioned, faithfully replayable baseline.
    return undefined;
  }
}
