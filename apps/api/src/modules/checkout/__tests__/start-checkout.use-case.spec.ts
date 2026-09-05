import test from "node:test";
import assert from "node:assert/strict";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { CheckoutSettingsPort } from "../domain/ports/checkout-settings.port.js";
import type { AgentContextPort } from "../domain/ports/agent-context.port.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { startCheckoutRequest } from "./checkout-test-fixtures.js";
import { StartCheckoutUseCase as ProductionStartCheckoutUseCase } from "../application/use-cases/start-checkout.use-case.js";
import { CheckoutCustomerService } from "../application/services/checkout-customer.service.js";
import { OtpService } from "../application/services/otp.service.js";
import { BuyerRecognitionService } from "../application/services/buyer-recognition.service.js";
import { BuyerAccountPersistenceService } from "../application/services/buyer-account-persistence.service.js";
import { InMemoryBuyerAccountRepository } from "../../buyer-account/infrastructure/in-memory-buyer-account.repository.js";
import { BuyerAccount } from "../../buyer-account/domain/entities/buyer-account.entity.js";

// These orchestration tests use a server catalog fixture. The real authority,
// including forged browser amounts, is exercised in checkout-trust-boundary.spec.ts.
class StartCheckoutUseCase extends ProductionStartCheckoutUseCase {
  constructor(...args: ConstructorParameters<typeof ProductionStartCheckoutUseCase>) {
    args[15] = { async resolve(_merchant: string, submitted: import("@zyon/shared-types").Cart) {
      const catalog = {
        kit: { name: "Kit", price: 300, cost: 120 },
        "ZYON-SHIRT-001": { name: "Camiseta Zyon Dev", price: 129.9 },
        "bag-001": { name: "Bolsa Executiva Couro Safiano", price: 449.9, cost: 210 },
      };
      const items = submitted.items.map(({ sku, quantity }) => {
        const product = catalog[sku as keyof typeof catalog];
        if (!product) throw new Error("unknown_fixture_sku");
        return { sku, quantity, ...product };
      });
      return { currency: "BRL", items, total: Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100 };
    } } as never;
    super(...args);
  }
}

function returningBuyerAccount(): BuyerAccount {
  return new BuyerAccount({
    globalUserId: "buyer_start_hydrate",
    email: "costaadiego1989@gmail.com",
    passwordHash: "hash",
    displayName: "Diego Costa",
    phone: "21993001883",
    cpf: "05178178700",
    address: {
      zip: "25958180",
      street: "Rua Paulo Lossio",
      number: "95",
      complement: "",
      neighborhood: "Araras",
      city: "Teresopolis",
      state: "RJ"
    },
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

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
      merchant_rules: [],
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

test("StartCheckoutUseCase keeps unverified email hints anonymous in every new session", async () => {
  const repository = new InMemoryCheckoutRepository();
  const useCase = new StartCheckoutUseCase(repository, repository, repository);

  const first = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_1", session_id: "chk_1" }));
  const second = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_1", session_id: "chk_2" }));
  const third = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_2", session_id: "chk_3" }));

  assert.notEqual(first.global_user_id, second.global_user_id);
  assert.notEqual(first.global_user_id, third.global_user_id);
});

test("StartCheckoutUseCase returns cross-sell suggestions in the initial experience", async () => {
  const repository = new InMemoryCheckoutRepository();
  const crossSell = {
    async suggest(input: { merchant_id: string; session_id: string; cart: { items: Array<{ sku: string }> } }) {
      assert.equal(input.merchant_id, "mrc_1");
      assert.equal(input.session_id, "chk_cross_sell_start");
      assert.equal(input.cart.items[0]?.sku, "ZYON-SHIRT-001");
      return [
        {
          suggestion_id: "sug_zyon",
          sku: "ZYON-HOOD-001",
          name: "Hoodie Agentic Checkout",
          unit_price: 199.9
        }
      ];
    }
  };
  const useCase = new StartCheckoutUseCase(
    repository,
    repository,
    repository,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { platformFeeBrl: 1.99 },
    crossSell
  );

  const response = await useCase.execute(startCheckoutRequest({
    session_id: "chk_cross_sell_start",
    cart: {
      currency: "BRL",
      total: 129.9,
      items: [{ sku: "ZYON-SHIRT-001", name: "Camiseta Zyon Dev", price: 129.9, quantity: 1 }]
    }
  }));

  assert.equal(response.experience.suggestedProducts?.[0]?.sku, "ZYON-HOOD-001");
  assert.equal(response.experience.suggestedProducts?.[0]?.name, "Hoodie Agentic Checkout");
  assert.equal(response.experience.suggestedProducts?.[0]?.unit_price, 199.9);
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
        name: "Northstar Atelier", plan: "BOTH",
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
    },
    async getStripeConnectAccountId() {
      return undefined;
    },
    async setStripeConnectAccountId() {},
    async updateStoreCategory() {},
    async getStoreSettings() { return {}; },
    async updateStoreSettings(_mid: string, s: any) { return s; }
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
  assert.equal(response.experience.totals.shipping, 0);
  assert.equal(response.experience.totals.total, 899.8);
  assert.ok(response.experience.copy.headline.includes("Northstar Atelier"));
  assert.equal(response.experience.stage, "data_collection");
  assert.ok(response.experience.copy.quick_replies.includes("Mandam rastreio por WhatsApp?"));
  assert.equal(response.experience.brand.theme.accentColor, "#FF0066");
  assert.equal(response.experience.brand.theme.fontFamily, "Manrope, system-ui, sans-serif");
  assert.equal(response.experience.brand.logo_url, "https://cdn.example.com/northstar-logo.png");
});

test("StartCheckoutUseCase does not hydrate a returning buyer before current-session verification", async () => {
  const repository = new InMemoryCheckoutRepository();
  const buyerAccounts = new InMemoryBuyerAccountRepository();
  await buyerAccounts.save(returningBuyerAccount());
  const otpService = new OtpService();
  const recognitionService = new BuyerRecognitionService(repository, buyerAccounts);
  const persistenceService = new BuyerAccountPersistenceService(buyerAccounts);
  const customerService = new CheckoutCustomerService(repository, undefined, otpService, recognitionService, persistenceService);
  const useCase = new StartCheckoutUseCase(
    repository,
    repository,
    repository,
    undefined,
    undefined,
    undefined,
    undefined,
    customerService
  );

  const response = await useCase.execute(
    startCheckoutRequest({
      session_id: "chk_embed_returning",
      customer: { email: "costaadiego1989@gmail.com", isReturning: false },
      shipping: undefined
    })
  );

  const session = await repository.getSession("mrc_1", "chk_embed_returning");
  assert.equal(session?.customer?.recognized_buyer, undefined);
  assert.equal(session?.customer?.email_verified, undefined);
  assert.equal(session?.customer?.fullName, undefined);
  assert.equal(session?.customer?.cpf, undefined);
  assert.equal(session?.customer?.phone_verified, undefined);
  assert.ok(!session?.customer?.otp_code);
  assert.equal(response.experience.stage, "data_collection");
  assert.notEqual(response.global_user_id, "buyer_start_hydrate");
});
