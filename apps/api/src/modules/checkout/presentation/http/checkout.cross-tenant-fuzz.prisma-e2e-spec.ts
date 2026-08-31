/**
 * Cross-tenant isolation fuzz — Prisma flavour.
 *
 * Same assertions as the in-memory variant (cross-tenant-fuzz.e2e-spec.ts) but
 * runs against a real PostgreSQL database so that the SQL-level WHERE merchantId
 * filter is exercised, not just the in-memory composite key.
 *
 * Gate: AACP_RUN_PRISMA_TESTS=1 + DATABASE_URL (otherwise skipped)
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentContext, Cart } from "@zyon/shared-types";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { PrismaCheckoutRepository } from "../../infrastructure/prisma/prisma-checkout.repository.js";
import { createStartCheckoutUseCase } from "../../application/use-cases/start-checkout.fixture.js";
import { GetCheckoutSessionUseCase } from "../../application/use-cases/get-checkout-session.use-case.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

const CART: Cart = {
  currency: "BRL",
  total: 200,
  items: [{ sku: "x", name: "Item", price: 200, cost: 100, quantity: 1, category: "Cat", variant: "V" }]
};

class FakeAgent implements AgentContextPort {
  constructor(private readonly merchantId: string) {}
  async get(): Promise<AgentContext> {
    return {
      merchant_id: this.merchantId,
      agent_id: "agent",
      agent: { agentName: "Z", persona: "Sales", tone: "consultative", language: "pt-BR", greeting: "Ola" },
      capabilities: {
        priceObjectionHandling: true,
        shippingObjectionHandling: true,
        trustReassurance: true,
        paymentFrictionGuidance: true,
        escalation: true,
        machineToMachineNegotiation: false
      },
      guardrails: {
        forbidUnauthorizedDiscounts: true,
        forbidUnauthorizedFreeShipping: true,
        forbidDeliveryPromisesWithoutSource: true,
        forbidStockPromisesWithoutSource: true,
        forbidPaymentStatusClaims: true,
        forbidLegalMedicalFinancialAdvice: true,
        forbidAbusivePressure: true,
        blockedPhrases: [],
        requiredDisclaimers: [],
        escalationTriggers: []
      },
      checkout_settings: {
        agentMode: "proactive",
        openWidgetOnTrigger: true,
        cooldownSeconds: 60,
        maxInterventionsPerSession: 3,
        triggerPreferences: [],
        handoffEnabled: true
      },
      copy_constraints: []
    };
  }
}

test(
  "Prisma FUZZ-001: 1000 cross-tenant session reads return null — no SQL-level data leakage",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const uid = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const MERCHANT_A = `mrc_fuzz_a_${uid}`;
    const MERCHANT_B = `mrc_fuzz_b_${uid}`;

    try {
      const repo = new PrismaCheckoutRepository(prisma);
      const startA = createStartCheckoutUseCase(repo, repo, { agentContext: new FakeAgent(MERCHANT_A) });
      const getUC = new GetCheckoutSessionUseCase(repo);

      const sessionsA: string[] = [];
      for (let i = 0; i < 10; i++) {
        const res = await startA.execute({
          merchant_id: MERCHANT_A,
          session_id: `sess_a_${uid}_${i}`,
          cart: CART
        });
        sessionsA.push(res.session_id);
      }

      let leaks = 0;
      for (let i = 0; i < 1000; i++) {
        const targetSession = sessionsA[i % sessionsA.length];
        let session: unknown = null;
        try {
          session = await getUC.execute(MERCHANT_B, targetSession);
        } catch {
          session = null;
        }
        if (session !== null) leaks++;
      }

      assert.equal(leaks, 0, `${leaks}/1000 cross-tenant reads exposed data at SQL level (must be 0)`);
    } finally {
      await prisma.checkoutEvent.deleteMany({ where: { merchantId: { startsWith: `mrc_fuzz_a_${uid}` } } });
      await prisma.checkoutSession.deleteMany({ where: { merchantId: { startsWith: `mrc_fuzz_a_${uid}` } } });
      await prisma.buyerIdentity.deleteMany({ where: { merchantId: { startsWith: `mrc_fuzz_a_${uid}` } } });
      await prisma.merchantRule.deleteMany({ where: { merchantId: { startsWith: `mrc_fuzz_a_${uid}` } } });
      await prisma.$disconnect();
    }
  }
);

test(
  "Prisma FUZZ-002: tenant A cannot read tenant B session by session_id alone (SQL boundary)",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const uid = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const MERCHANT_A = `mrc_fuzz2_a_${uid}`;
    const MERCHANT_B = `mrc_fuzz2_b_${uid}`;

    try {
      const repo = new PrismaCheckoutRepository(prisma);
      const startB = createStartCheckoutUseCase(repo, repo, { agentContext: new FakeAgent(MERCHANT_B) });
      const getUC = new GetCheckoutSessionUseCase(repo);

      const { session_id: bSessionId } = await startB.execute({
        merchant_id: MERCHANT_B,
        session_id: `sess_b_secret_${uid}`,
        cart: CART
      });

      let leakDetected = false;
      try {
        await getUC.execute(MERCHANT_A, bSessionId);
        leakDetected = true;
      } catch {
        leakDetected = false;
      }

      assert.equal(leakDetected, false, "Merchant A must not access Merchant B session at SQL level");
    } finally {
      await prisma.checkoutEvent.deleteMany({ where: { merchantId: { startsWith: `mrc_fuzz2_b_${uid}` } } });
      await prisma.checkoutSession.deleteMany({ where: { merchantId: { startsWith: `mrc_fuzz2_b_${uid}` } } });
      await prisma.buyerIdentity.deleteMany({ where: { merchantId: { startsWith: `mrc_fuzz2_b_${uid}` } } });
      await prisma.merchantRule.deleteMany({ where: { merchantId: { startsWith: `mrc_fuzz2_b_${uid}` } } });
      await prisma.$disconnect();
    }
  }
);
