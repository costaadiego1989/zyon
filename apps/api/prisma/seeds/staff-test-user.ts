/**
 * Seed a STAFF test user attached to the first merchant.
 * Used by the Playwright e2e suite (apps/dashboard/e2e/staff-role-access.spec.ts).
 *
 * Run: cd apps/api && pnpm tsx prisma/seeds/staff-test-user.ts
 * Idempotent — safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes, scryptSync } from "node:crypto";

process.env.DATABASE_URL ??=
  "postgresql://atendeai:atendeai_dev@localhost:5434/aacp_dev?schema=public";

const STAFF_EMAIL = process.env.STAFF_TEST_EMAIL ?? "staff+e2e@zyon.test";
const STAFF_PASSWORD = process.env.STAFF_TEST_PASSWORD ?? "StaffPass1!";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/** scryptSync-based hash matching PasswordHasher service in apps/api */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

async function main() {
  const merchant = await prisma.merchant.findFirst({
    select: { id: true, name: true },
  });
  if (!merchant) {
    console.error("No merchant found — run main seed first.");
    process.exit(1);
  }

  const passwordHash = hashPassword(STAFF_PASSWORD);

  // Upsert user
  const user = await prisma.merchantUser.upsert({
    where: { email: STAFF_EMAIL },
    create: {
      merchantId: merchant.id,
      email: STAFF_EMAIL,
      passwordHash,
      role: "STAFF",
    },
    update: {
      passwordHash,
      role: "STAFF",
      merchantId: merchant.id,
    },
  });

  // Upsert team member
  await prisma.merchantTeamMember.upsert({
    where: { merchantId_userId: { merchantId: merchant.id, userId: user.id } },
    create: {
      merchantId: merchant.id,
      userId: user.id,
      role: "STAFF",
    },
    update: {
      role: "STAFF",
    },
  });

  console.log(`✅ STAFF test user seeded: ${STAFF_EMAIL} for merchant ${merchant.name}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
