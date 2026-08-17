import { Prisma } from "@prisma/client";
import { createPrismaClient } from "../shared/persistence/prisma-client.js";

const p = createPrismaClient();
const merchant = await p.merchant.findUnique({ where: { id: "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa" } });
if (!merchant) { console.log("Not found"); await p.$disconnect(); process.exit(1); }

const settings = (merchant.storeSettings ?? {}) as Record<string, unknown>;
settings.slug = "cosmos";
await p.merchant.update({ where: { id: merchant.id }, data: { storeSettings: settings as Prisma.InputJsonValue } });
console.log(`Fixed slug to "cosmos" for ${merchant.name}`);
await p.$disconnect();
