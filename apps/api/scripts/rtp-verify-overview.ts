// RTP audit: independently compute Overview revenue metrics from the DB
// and compare against the store-overview endpoint. E3 evidence — reads only.
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(import.meta.dirname ?? __dirname, "..", ".env") });

import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";

const prisma = createPrismaClient();
const merchantId = process.env.RTP_MERCHANT_ID;

function range(period: string) {
  const now = new Date();
  const from = new Date(now);
  if (period === "today") from.setHours(0, 0, 0, 0);
  else if (period === "7d") from.setDate(from.getDate() - 7);
  else if (period === "30d") from.setDate(from.getDate() - 30);
  else if (period === "90d") from.setDate(from.getDate() - 90);
  return { from, to: now };
}

async function main() {
  if (!merchantId) throw new Error("Set RTP_MERCHANT_ID");
  const out: Record<string, unknown> = {};
  for (const period of ["today", "7d", "30d", "90d"]) {
    const { from, to } = range(period);
    const orders = await prisma.completedOrder.findMany({
      where: { merchantId, completedAt: { gte: from, lte: to } },
      select: { orderTotal: true, status: true },
    });
    const revenue = orders.reduce((s, o) => s + Number(o.orderTotal), 0);
    const count = orders.length;
    const avg = count > 0 ? revenue / count : 0;
    const byStatus: Record<string, number> = {};
    for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    out[period] = {
      orders_count: count,
      revenue: Math.round(revenue * 100) / 100,
      average_ticket: Math.round(avg * 100) / 100,
      by_status: byStatus,
    };
  }
  out.all_time_orders = await prisma.completedOrder.count({ where: { merchantId } });
  console.log("RTP_OVERVIEW_START" + JSON.stringify(out) + "RTP_OVERVIEW_END");
}

main()
  .catch((e) => {
    console.error("ERR", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
