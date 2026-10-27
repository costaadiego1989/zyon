import { createPrismaClient } from "../shared/persistence/prisma-client.js";
import { createHash, randomBytes } from "node:crypto";

const prisma = createPrismaClient();

// Check if user exists for password reset
const user = await prisma.merchantUser.findFirst({ where: { email: "costaadiego1989@gmail.com" } });
console.log("User found:", !!user, user?.id, user?.email);

await prisma.$disconnect();
