import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const r = await p.coupon.findUnique({ where: { merchantId_code: { merchantId: "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa", code: "WELCOME10" } } });
console.log("Result:", r ? r.id : "NULL");
console.log("Code:", r?.code);
console.log("Status:", r?.status);
await p.$disconnect();
