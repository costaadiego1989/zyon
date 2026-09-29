import type { PrismaClient } from "@prisma/client";
import { weeklyAnalysisEnabled, weeklyMerchantAllowed } from "../../revenue-manager/domain/weekly-analysis-policy.js";

/** Migration ownership outlives flags. Legacy inference/promotion cannot make
 * decisions for the new weekly workflow, including when that workflow is paused. */
export async function requiresWeeklyReview(prisma: PrismaClient, merchantId: string): Promise<boolean> {
  if (weeklyAnalysisEnabled() && weeklyMerchantAllowed(merchantId)) return true;
  return Boolean(await prisma.revenueAnalysisSchedule.findUnique({
    where: { merchantId }, select: { merchantId: true },
  }));
}
