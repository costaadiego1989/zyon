import { createPrismaClient } from "../shared/persistence/prisma-client.js";
const p = createPrismaClient();
const merchants = await p.merchant.findMany({ select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 10 });
console.log("Merchants:");
merchants.forEach(m => console.log(`  ${m.id} | ${m.name} | ${m.createdAt.toISOString()}`));

const users = await p.merchantUser.findMany({ select: { id: true, email: true, merchantId: true }, take: 10 });
console.log("\nUsers:");
users.forEach(u => console.log(`  ${u.email} | merchant: ${u.merchantId}`));

await p.$disconnect();
