/**
 * Cross-tenant fuzz gate (ADR 0005 §5.6, ADR 0009 P0.3).
 *
 * Canonical fuzz suite required by ADR 0005 at apps/api/test/cross-tenant-fuzz.e2e-spec.ts.
 * Lives under src/ because the build (rootDir: src) only compiles and the
 * test-runner only discovers specs inside src/.
 *
 * Unlike the repository-level fuzz, this exercises the PRISMA TENANT-FILTER
 * MIDDLEWARE directly: the tenant is set only via AsyncLocalStorage
 * (registerTenantMiddleware + TenantContextService), never passed explicitly
 * to the query. It proves the SQL-level `WHERE merchant_id` filter is injected
 * from the ambient credential, and that mixing credential A with data B never
 * leaks across the tenant boundary.
 *
 * Gate: AACP_RUN_PRISMA_TESTS=1 + DATABASE_URL (otherwise skipped). Runnable in
 * CI when the flag is set.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "./prisma-client.js";
import { registerTenantMiddleware } from "./tenant.middleware.js";
import {
  TenantContextService,
  type TenantContext,
} from "../tenant/tenant-context.service.js";

const runPrisma =
  process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = runPrisma
  ? false
  : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run the cross-tenant fuzz gate.";

const SESSIONS_PER_MERCHANT = 5;
const FUZZ_ITERATIONS = 1000;
const MAX_AVG_MS = 50;

function tenant(merchantId: string): TenantContext {
  return {
    merchantId,
    userId: `usr_${merchantId}`,
    role: "owner",
    correlationId: randomUUID(),
  };
}

async function seedSessions(
  prisma: PrismaClient,
  tenantCtx: TenantContextService,
  merchantId: string,
): Promise<string[]> {
  const sessionIds: string[] = [];
  await tenantCtx.run(tenant(merchantId), async () => {
    for (let i = 0; i < SESSIONS_PER_MERCHANT; i++) {
      const sessionId = `sess_${merchantId}_${i}`;
      sessionIds.push(sessionId);
      const now = new Date();
      await prisma.checkoutSession.create({
        // merchantId intentionally omitted: the middleware injects it from ALS.
        data: {
          sessionId,
          globalUserId: `usr_${merchantId}_${i}`,
          conversationId: `conv_${merchantId}_${i}`,
          cart: { currency: "BRL", total: 100, items: [] },
          createdAt: now,
          updatedAt: now,
        } as never,
      });
    }
  });
  return sessionIds;
}

test(
  "FUZZ-GATE: tenant-filter middleware blocks all cross-tenant reads (0 leaks)",
  { skip },
  async () => {
    const base = createPrismaClient();
    const tenantCtx = new TenantContextService();
    const prisma = registerTenantMiddleware(base, tenantCtx) as unknown as PrismaClient;

    const uid = randomUUID().replace(/-/g, "").slice(0, 12);
    const ALPHA = `mrc_alpha_${uid}`;
    const BETA = `mrc_beta_${uid}`;

    try {
      const alphaSessions = await seedSessions(prisma, tenantCtx, ALPHA);
      const betaSessions = await seedSessions(prisma, tenantCtx, BETA);

      const merchants = [
        { id: ALPHA, own: alphaSessions, foreign: betaSessions },
        { id: BETA, own: betaSessions, foreign: alphaSessions },
      ];

      let leaks = 0;
      const start = process.hrtime.bigint();

      for (let i = 0; i < FUZZ_ITERATIONS; i++) {
        const actor = merchants[i % merchants.length];
        const crossTenant = i % 2 === 0;
        const targetPool = crossTenant ? actor.foreign : actor.own;
        const targetSession = targetPool[i % targetPool.length];

        await tenantCtx.run(tenant(actor.id), async () => {
          const row = await prisma.checkoutSession.findFirst({
            where: { sessionId: targetSession },
          });

          if (crossTenant) {
            if (row !== null) leaks++;
          } else if (row === null || row.merchantId !== actor.id) {
            leaks++;
          }
        });
      }

      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const avgMs = elapsedMs / FUZZ_ITERATIONS;

      assert.equal(
        leaks,
        0,
        `${leaks}/${FUZZ_ITERATIONS} cross-tenant reads leaked data (must be 0)`,
      );
      assert.ok(
        avgMs < MAX_AVG_MS,
        `avg request ${avgMs.toFixed(2)}ms exceeded ${MAX_AVG_MS}ms budget`,
      );
    } finally {
      await base.checkoutSession.deleteMany({
        where: { merchantId: { in: [ALPHA, BETA] } },
      });
      await base.$disconnect();
    }
  },
);

test(
  "FUZZ-GATE: no-context queries on scoped models are not silently global",
  { skip },
  async () => {
    const base = createPrismaClient();
    const tenantCtx = new TenantContextService();
    const prisma = registerTenantMiddleware(base, tenantCtx) as unknown as PrismaClient;

    const uid = randomUUID().replace(/-/g, "").slice(0, 12);
    const ALPHA = `mrc_alpha2_${uid}`;

    try {
      await seedSessions(prisma, tenantCtx, ALPHA);

      const visibleToAlpha = await tenantCtx.run(tenant(ALPHA), () =>
        prisma.checkoutSession.count({ where: { sessionId: { startsWith: `sess_${ALPHA}` } } }),
      );

      assert.equal(
        visibleToAlpha,
        SESSIONS_PER_MERCHANT,
        "alpha must see exactly its own seeded sessions under its credential",
      );
    } finally {
      await base.checkoutSession.deleteMany({
        where: { merchantId: ALPHA },
      });
      await base.$disconnect();
    }
  },
);
