import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaBuyerAccountRepository } from "../src/modules/buyer-account/infrastructure/prisma-buyer-account.repository.js";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const repo = new PrismaBuyerAccountRepository(prisma as any);
const acc = await repo.findByGlobalUserId("usr_f2ca2331-b4cd-49f8-9221-c756c94860af");
console.log("account:", acc ? JSON.stringify({ email: acc.email, phone: acc.phone, name: acc.displayName }) : "NULL");
await prisma.$disconnect();
