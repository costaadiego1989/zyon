import { createPrismaClient } from "../shared/persistence/prisma-client.js";
const p = createPrismaClient();
const m = await p.merchant.findFirst({ where: { name: "Cosmos" }, select: { theme: true } });
console.log(JSON.stringify(m?.theme, null, 2));
await p.$disconnect();
