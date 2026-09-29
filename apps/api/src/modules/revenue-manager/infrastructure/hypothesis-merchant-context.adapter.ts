import type { PrismaClient } from "@prisma/client";
import type { MerchantRules } from "@zyon/shared-types";
import type { HypothesisMerchantContextPort } from "../domain/ports/hypothesis-merchant-context.port.js";
import { readCheckoutBaseline } from "./checkout-baseline.reader.js";
import { checkoutBaselineReference } from "../../checkout/domain/services/checkout-chat-baseline.js";
import { prepareStrategyMeasurement } from "./strategy-measurement-planning.js";
import { prepareDiscountStudy } from "./strategy-discount-study.js";

/** Unlike MerchantRulesRepository.getRules, this ACL never creates permissive defaults. */
export class PrismaHypothesisMerchantContext implements HypothesisMerchantContextPort {
  constructor(private readonly prisma: PrismaClient) {}

  async getRules(merchantId: string): Promise<MerchantRules | undefined> {
    const row = await this.prisma.merchantRule.findUnique({ where: { merchantId } });
    if (!row) return undefined;
    return merchantRulesSnapshot(row);
  }

  async getCurrentPrompt(merchantId: string): Promise<string | undefined> {
    const baseline = await this.getCheckoutBaseline(merchantId);
    return baseline ? checkoutBaselineReference(baseline) : undefined;
  }

  async getCheckoutBaseline(merchantId: string) {
    if (process.env.REVENUE_CHECKOUT_CONTRACT_ENABLED !== "true") return undefined;
    return this.prisma.$transaction(tx => readCheckoutBaseline(tx, merchantId), { isolationLevel: "RepeatableRead" });
  }

  getMeasurementPlanning(merchantId: string, context: { runId: string; leaseToken: number }) {
    return prepareStrategyMeasurement(this.prisma, merchantId, context);
  }

  getDiscountStudy(merchantId: string, context: { runId: string; leaseToken: number }) {
    return prepareDiscountStudy(this.prisma, merchantId, context);
  }
}

export function merchantRulesSnapshot(row: import("@prisma/client").MerchantRule): MerchantRules {
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
