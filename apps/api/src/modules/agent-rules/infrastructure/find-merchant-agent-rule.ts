import type { PrismaClient } from "@prisma/client";

/** One public identity per merchant. Legacy console settings are read until the first merchant save. */
export async function findMerchantAgentRule(prisma: PrismaClient, merchantId: string) {
  const current = await prisma.agentRule.findFirst({
    where: { merchantId, agentId: "default", userId: null, scope: "merchant_default" },
  });
  if (current) return current;
  return prisma.agentRule.findFirst({
    where: { merchantId, scope: "user_agent", agentId: { startsWith: "agt_" } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
}
