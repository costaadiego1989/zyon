// RTP audit: verify integrity of existing CompletedOrders. E3 reads only.
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dirname ?? __dirname, "..", ".env") });
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";
const prisma = createPrismaClient();
const merchantId = process.env.RTP_MERCHANT_ID!;

async function main() {
  const orders = await prisma.completedOrder.findMany({
    where: { merchantId },
    orderBy: { completedAt: "desc" },
  });

  const issues: string[] = [];
  let nullSession = 0, zeroTotal = 0, negTotal = 0, missingStatus = 0, futureDate = 0;
  const now = Date.now();
  const statuses = new Set<string>();
  const currencies = new Set<string>();

  for (const o of orders as Array<Record<string, any>>) {
    const total = Number(o.orderTotal);
    if (!o.sessionId) nullSession++;
    if (total === 0) zeroTotal++;
    if (total < 0) negTotal++;
    if (!o.status) missingStatus++; else statuses.add(o.status);
    if (o.currency) currencies.add(o.currency);
    if (o.completedAt && new Date(o.completedAt).getTime() > now + 60_000) futureDate++;
  }

  // cross-tenant leak check: any order whose merchantId != tenant returned? (shouldn't happen since we filter)
  const otherTenantSample = await prisma.completedOrder.findMany({
    where: { merchantId: { not: merchantId } },
    select: { id: true, merchantId: true },
    take: 3,
  });

  const fields = orders[0] ? Object.keys(orders[0]) : [];

  console.log("RTP_ORDER_INTEGRITY_START" + JSON.stringify({
    total: orders.length,
    fields,
    statuses: [...statuses],
    currencies: [...currencies],
    checks: { nullSession, zeroTotal, negTotal, missingStatus, futureDate },
    otherTenantOrdersExist: otherTenantSample.length,
    sample: orders.slice(0, 3).map((o: any) => ({
      id: String(o.id).slice(0, 12),
      total: Number(o.orderTotal),
      status: o.status,
      sessionId: o.sessionId ? String(o.sessionId).slice(0, 10) : null,
      completedAt: o.completedAt,
    })),
  }) + "RTP_ORDER_INTEGRITY_END");
}
main().catch((e) => { console.error("ERR", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
