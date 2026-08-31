/**
 * Cross-tenant isolation fuzz test.
 *
 * Validates that sessions keyed by (merchant_id, session_id) cannot be read
 * cross-tenant. The InMemory repo enforces this via composite key lookup.
 * In Prisma mode the tenant middleware adds an automatic WHERE merchantId filter.
 *
 * Gate: pnpm test (1000 iterations, 0 leaks)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { GetCheckoutSessionUseCase } from "../../application/use-cases/get-checkout-session.use-case.js";
import { createStartCheckoutUseCase } from "../../application/use-cases/start-checkout.fixture.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import type { AgentContext, Cart } from "@zyon/shared-types";

const CART: Cart = {
  currency: "BRL", source: "storefront", total: 200,
  items: [{ sku: "x", name: "Item", price: 200, cost: 100, quantity: 1, category: "Cat", variant: "V" }]
};

class FakeAgent implements AgentContextPort {
  constructor(private readonly merchantId: string) {}
  async get(): Promise<AgentContext> {
    return {
      merchant_id: this.merchantId, agent_id: "agent",
      agent: { agentName: "Z", persona: "Sales", tone: "consultative", language: "pt-BR", greeting: "Ola" },
      capabilities: { priceObjectionHandling: true, shippingObjectionHandling: true, trustReassurance: true, paymentFrictionGuidance: true, escalation: true, machineToMachineNegotiation: false },
      guardrails: { forbidUnauthorizedDiscounts: true, forbidUnauthorizedFreeShipping: true, forbidDeliveryPromisesWithoutSource: true, forbidStockPromisesWithoutSource: true, forbidPaymentStatusClaims: true, forbidLegalMedicalFinancialAdvice: true, forbidAbusivePressure: true, blockedPhrases: [], requiredDisclaimers: [], escalationTriggers: [] },
      checkout_settings: { agentMode: "proactive", openWidgetOnTrigger: true, cooldownSeconds: 60, maxInterventionsPerSession: 3, triggerPreferences: [], handoffEnabled: true },
      copy_constraints: []
    };
  }
}

test("FUZZ-001: 1000 cross-tenant session reads return null — no data leakage", async () => {
  const tenantCtx = new TenantContextService();
  const repo = new InMemoryCheckoutRepository();

  const MERCHANT_A = "mrc_fuzz_a";
  const MERCHANT_B = "mrc_fuzz_b";

  const startA = createStartCheckoutUseCase(repo, repo, { agentContext: new FakeAgent(MERCHANT_A) });
  const getUC = new GetCheckoutSessionUseCase(repo);

  const sessionsA: string[] = [];
  for (let i = 0; i < 10; i++) {
    const res = await startA.execute({ merchant_id: MERCHANT_A, session_id: `sess_a_${i}`, cart: CART });
    sessionsA.push(res.session_id);
  }

  let leaks = 0;

  for (let i = 0; i < 1000; i++) {
    const targetSession = sessionsA[i % sessionsA.length];

    await tenantCtx.run({ merchantId: MERCHANT_B, userId: "u_b", role: "owner" }, async () => {
      let session: unknown = null;
      try {
        // Merchant B requests merchant A's session using merchant B's identity
        session = await getUC.execute(MERCHANT_B, targetSession);
      } catch {
        session = null;
      }
      if (session !== null) leaks++;
    });
  }

  assert.equal(leaks, 0, `${leaks}/1000 cross-tenant reads exposed data (must be 0)`);
});

test("FUZZ-002: tenant A cannot read tenant B sessions even with correct session_id", async () => {
  const repo = new InMemoryCheckoutRepository();

  const MERCHANT_A = "mrc_fuzz2_a";
  const MERCHANT_B = "mrc_fuzz2_b";

  const startB = createStartCheckoutUseCase(repo, repo, { agentContext: new FakeAgent(MERCHANT_B) });
  const getUC = new GetCheckoutSessionUseCase(repo);

  const { session_id: bSessionId } = await startB.execute({ merchant_id: MERCHANT_B, session_id: "sess_b_secret", cart: CART });

  // Merchant A knows the session_id but uses wrong merchant_id
  let leakDetected = false;
  try {
    await getUC.execute(MERCHANT_A, bSessionId);
    leakDetected = true;
  } catch {
    leakDetected = false;
  }

  assert.equal(leakDetected, false, "merchant A must not access merchant B session with correct session_id");
});
