import test from "node:test";
import assert from "node:assert/strict";
import type { AgentContext } from "@aacp/shared-types";
import type { GetAgentContextUseCase } from "../../../agent-rules/application/agent-rules.use-cases.js";
import type { GetBuyerPurchaseContextUseCase } from "../../../buyer-purchase-history/application/buyer-purchase-history.use-cases.js";
import { AgentRulesContextAdapter } from "./agent-rules-context.adapter.js";

test("AgentRulesContextAdapter composes safe purchase history context for checkout conversation", async () => {
  const adapter = new AgentRulesContextAdapter(
    {
      async execute() {
        return testAgentContext();
      }
    } as unknown as GetAgentContextUseCase,
    {
      async execute(input: { merchantId: string; globalUserId?: string }) {
        return {
          merchant_id: input.merchantId,
          global_user_id: input.globalUserId,
          purchase_history: {
            known_buyer: true,
            orders_count: 3,
            lifetime_value: 420,
            average_order_value: 140,
            last_order_at: "2026-04-20T12:00:00.000Z",
            top_categories: ["running-shoes"],
            recent_skus: ["shoe-001"],
            discount_sensitivity: "medium",
            returning_customer_copy_hint: "Thank the buyer for coming back without mentioning private details."
          }
        };
      }
    } as unknown as GetBuyerPurchaseContextUseCase
  );

  const context = await adapter.get({
    merchantId: "mrc_1",
    agentId: "closer-1",
    globalUserId: "usr_global_1"
  });

  assert.equal(context?.purchase_history?.known_buyer, true);
  assert.equal(context?.purchase_history?.orders_count, 3);
  assert.deepEqual(context?.purchase_history?.recent_skus, ["shoe-001"]);
  assert.equal("email" in (context?.purchase_history ?? {}), false);
  assert.equal(context?.copy_constraints.some((constraint) => constraint.includes("purchase history")), true);
});

function testAgentContext(): AgentContext {
  return {
    merchant_id: "mrc_1",
    agent_id: "closer-1",
    agent: {
      agentName: "Nina",
      persona: "checkout sales agent",
      tone: "consultative",
      language: "pt-BR",
      greeting: "Oi, posso ajudar a finalizar com seguranca."
    },
    capabilities: {
      priceObjectionHandling: true,
      shippingObjectionHandling: true,
      trustReassurance: true,
      paymentFrictionGuidance: true,
      escalation: true,
      machineToMachineNegotiation: true
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
      agentMode: "silent_until_trigger",
      openWidgetOnTrigger: true,
      cooldownSeconds: 120,
      maxInterventionsPerSession: 3,
      triggerPreferences: ["coupon_field_clicked"],
      handoffEnabled: true
    },
    copy_constraints: ["Mention offers only when authorized by deterministic modules."]
  };
}
