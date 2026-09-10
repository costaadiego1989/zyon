import type { PrismaClient } from "@prisma/client";
import type { AdvancedRule } from "../../checkout/domain/services/advanced-rule-evaluator.service.js";
export { productRuleNotices } from "../domain/services/advanced-rule-notices.js";

export async function loadProductNoticeRules(prisma: PrismaClient, merchantId: string): Promise<AdvancedRule[]> {
  const setting = await prisma.checkoutSetting.findUnique({ where: { merchantId }, select: { advancedRules: true } });
  return Array.isArray(setting?.advancedRules) ? setting.advancedRules as unknown as AdvancedRule[] : [];
}
