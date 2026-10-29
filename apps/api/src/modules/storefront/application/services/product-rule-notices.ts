import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { readExistingMerchantRules } from "../../../merchant/application/services/read-existing-merchant-rules.js";
import type { AdvancedRule } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
export { productRuleNotices } from "../../domain/services/advanced-rule-notices.js";

export async function loadProductNoticeRules(prisma: PrismaClient, merchantId: string, merchantRepo?: Pick<MerchantRepository, "getRules">): Promise<AdvancedRule[]> {
  const setting = await prisma.checkoutSetting.findUnique({ where: { merchantId }, select: { advancedRules: true } });
  const rules = Array.isArray(setting?.advancedRules) ? setting.advancedRules as unknown as AdvancedRule[] : [];
  if (!rules.some(rule => rule?.action?.type === "offer_discount" || rule?.action?.type === "offer_free_shipping")) return rules;
  const rawPolicy = merchantRepo ? await readExistingMerchantRules(merchantRepo, merchantId).catch(() => null) : null;
  const checked = z.object({ maxDiscountPercent: z.number().finite().min(0).max(100), allowFreeShipping: z.boolean() }).safeParse(rawPolicy);
  return rules.flatMap(rule => {
    if (rule?.action?.type === "offer_free_shipping") return checked.success && checked.data.allowFreeShipping ? [rule] : [];
    if (rule?.action?.type !== "offer_discount") return [rule];
    const percent = Number(rule.action.params.percent);
    if (!checked.success || checked.data.maxDiscountPercent === 0 || !Number.isFinite(percent) || percent <= 0) return [];
    return [{ ...rule, action: { ...rule.action, params: { ...rule.action.params, percent: Math.min(percent, checked.data.maxDiscountPercent) } } }];
  });
}

