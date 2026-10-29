import type { Prisma } from "@prisma/client";
import { incentivePolicySnapshot } from "../domain/incentive-policy.js";

export async function readIncentivePolicy(tx: Prisma.TransactionClient, merchantId: string) {
  return (await readIncentivePolicyState(tx, merchantId)).snapshot;
}

export async function readIncentivePolicyState(tx: Prisma.TransactionClient, merchantId: string) {
  const row = await tx.merchantIncentivePolicy.findFirst({ where: { merchantId }, orderBy: { version: "desc" } });
  const snapshot = incentivePolicySnapshot(merchantId, row?.version ?? 0,
    row ?? { enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 });
  if (row && row.policyHash !== snapshot.policyHash) throw new Error("INCENTIVE_POLICY_CORRUPT");
  const mode = !row || row.origin === "automatic" ? "automatic" as const : row.enabled ? "manual" as const : "disabled" as const;
  return { snapshot, mode, approvedReviewId: row?.approvedReviewId ?? null };
}
