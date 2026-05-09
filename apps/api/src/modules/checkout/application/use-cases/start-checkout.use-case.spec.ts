import test from "node:test";
import assert from "node:assert/strict";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { startCheckoutRequest } from "../../__tests__/checkout-test-fixtures.js";
import { StartCheckoutUseCase } from "./start-checkout.use-case.js";

class ManualOnlyCheckoutSettingsPort implements CheckoutSettingsPort {
  async getContext(merchantId: string) {
    return {
      merchant_id: merchantId,
      checkout_settings: {
        mode: "manual_only" as const,
        open_widget_on_trigger: false,
        minimum_abandonment_score: 0.9,
        cooldown_seconds: 300,
        max_interventions_per_session: 1,
        enabled_triggers: ["payment_failed" as const],
        handoff_enabled: false
      },
      operational_constraints: []
    };
  }
}

test("StartCheckoutUseCase creates session, records start event, and appends outbox fact", async () => {
  const repository = new InMemoryCheckoutRepository();
  const useCase = new StartCheckoutUseCase(repository, repository, repository);
  const response = await useCase.execute(startCheckoutRequest({ session_id: "chk_custom" }));

  const session = repository.getSession("mrc_1", "chk_custom");
  assert.equal(response.session_id, "chk_custom");
  assert.equal(session?.conversationId, response.conversation_id);
  assert.equal(session?.globalUserId, response.global_user_id);
  assert.equal(repository.listOutbox("mrc_1")[0]?.event_type, "checkout.session.started");
});

test("StartCheckoutUseCase reuses global user only inside the same merchant", async () => {
  const repository = new InMemoryCheckoutRepository();
  const useCase = new StartCheckoutUseCase(repository, repository, repository);

  const first = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_1", session_id: "chk_1" }));
  const second = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_1", session_id: "chk_2" }));
  const third = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_2", session_id: "chk_3" }));

  assert.equal(first.global_user_id, second.global_user_id);
  assert.notEqual(first.global_user_id, third.global_user_id);
});

test("StartCheckoutUseCase respects manual-only checkout settings", async () => {
  const repository = new InMemoryCheckoutRepository();
  const useCase = new StartCheckoutUseCase(repository, repository, repository, new ManualOnlyCheckoutSettingsPort());

  const response = await useCase.execute(startCheckoutRequest({ session_id: "chk_manual" }));

  assert.equal(response.agent_enabled, false);
  assert.equal(response.initial_mode, "silent");
});

test("StartCheckoutUseCase returns enterprise experience from merchant, cart, shipping, and agent context", async () => {
  const repository = new InMemoryCheckoutRepository();
  const merchantRepository: MerchantRepository = {
    async getProfile() {
      return {
        id: "mrc_1",
        name: "Northstar Atelier",
        theme: {
          accentColor: "#FF0066",
          textColor: "#0F172A",
          backgroundColor: "#FFFFFF",
          fontFamily: "Manrope, system-ui, sans-serif",
          logoUrl: "https://cdn.example.com/northstar-logo.png"
        }
      };
    },
    async getRules() {
      return {
        maxDiscountPercent: 10,
        minimumMarginPercent: 38,
        allowFreeShipping: true,
        allowShippingDiscount: true,
        allowBonusItem: false,
        allowStackDiscountAndFreeShipping: false,
        freeShippingMinCartValue: 250,
        maxShippingSubsidy: 45,
        maxPartialShippingDiscount: 20,
        offerExpirationMinutes: 15,
        blockedRegions: [],
        brandVoice: "premium",
        couponBoxEnabled: true
      };
    },
    async updateRules() {
      return this.getRules("mrc_1");
    },
    async updateTheme(_, theme) {
      return theme;
    }
  };
  const agentContext: AgentContextPort = {
    async get() {
      return {
        merchant_id: "mrc_1",
        agent_id: "default",
        agent: {
          agentName: "Clara",
          persona: "consultora de checkout",
          tone: "premium",
          language: "pt-BR",
          greeting: "Sou a Clara, posso ajudar a fechar sua compra com segurança."
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
          agentMode: "proactive",
          openWidgetOnTrigger: true,
          cooldownSeconds: 60,
          maxInterventionsPerSession: 3,
          triggerPreferences: ["shipping_objection_detected"],
          handoffEnabled: true
        },
        copy_constraints: []
      };
    }
  };
  const useCase = new StartCheckoutUseCase(repository, repository, repository, undefined, merchantRepository, agentContext);

  const response = await useCase.execute(
    startCheckoutRequest({
      session_id: "chk_enterprise",
      cart: {
        currency: "BRL",
        total: 899.8,
        source: "storefront",
        items: [
          {
            sku: "bag-001",
            name: "Bolsa Executiva Couro Safiano",
            price: 449.9,
            cost: 210,
            quantity: 2,
            imageUrl: "https://cdn.example.com/bag.png",
            productUrl: "https://shop.example.com/bag-001",
            category: "Bolsas",
            variant: "Preta"
          }
        ]
      },
      shipping: { customerPrice: 29.9, realCost: 31, carrier: "Loggi", method: "Express", deliveryDays: 2, region: "SP" }
    })
  );

  assert.equal(response.experience.brand.name, "Northstar Atelier");
  assert.equal(response.experience.agent.name, "Clara");
  assert.equal(response.experience.items[0]?.name, "Bolsa Executiva Couro Safiano");
  assert.equal(response.experience.items[0]?.line_total, 899.8);
  assert.equal(response.experience.totals.subtotal, 899.8);
  assert.equal(response.experience.totals.shipping, 29.9);
  assert.equal(response.experience.totals.total, 929.7);
  assert.ok(response.experience.copy.headline.includes("Northstar Atelier"));
  assert.equal(response.experience.stage, "data_collection");
  assert.ok(response.experience.copy.quick_replies.includes("Por que precisa do meu nome?"));
  assert.equal(response.experience.brand.theme.accentColor, "#FF0066");
  assert.equal(response.experience.brand.theme.fontFamily, "Manrope, system-ui, sans-serif");
  assert.equal(response.experience.brand.logo_url, "https://cdn.example.com/northstar-logo.png");
});
