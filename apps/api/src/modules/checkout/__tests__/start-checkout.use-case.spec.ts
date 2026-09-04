import test from "node:test";
import assert from "node:assert/strict";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { CheckoutSettingsPort } from "../domain/ports/checkout-settings.port.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { startCheckoutRequest } from "./checkout-test-fixtures.js";
import { BuyerAccount } from "../../buyer-account/domain/entities/buyer-account.entity.js";
import { createStartCheckoutUseCase } from "../application/use-cases/start-checkout.fixture.js";

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

  async getInterventionConfig() {
    return { advancedRules: null, interventionPolicy: null };
  }
}

test("StartCheckoutUseCase creates session, records start event, and appends outbox fact", async () => {
  const repository = new InMemoryCheckoutRepository();
  const useCase = createStartCheckoutUseCase(repository, repository);
  const response = await useCase.execute(startCheckoutRequest({ session_id: "chk_custom" }));

  const session = repository.getSession("mrc_1", "chk_custom");
  assert.equal(response.session_id, "chk_custom");
  assert.equal(session?.conversationId, response.conversation_id);
  assert.equal(session?.globalUserId, response.global_user_id);
  assert.equal(repository.listOutbox("mrc_1")[0]?.event_type, "checkout.session.started");
});

test("StartCheckoutUseCase reuses global user only inside the same merchant", async () => {
  const repository = new InMemoryCheckoutRepository();
  const useCase = createStartCheckoutUseCase(repository, repository);

  const first = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_1", session_id: "chk_1" }));
  const second = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_1", session_id: "chk_2" }));
  const third = await useCase.execute(startCheckoutRequest({ merchant_id: "mrc_2", session_id: "chk_3" }));

  assert.equal(first.global_user_id, second.global_user_id);
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

  const useCase = createStartCheckoutUseCase(repository, repository, { crossSell: crossSell as any });

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
  const useCase = createStartCheckoutUseCase(repository, repository, {
    checkoutSettings: new ManualOnlyCheckoutSettingsPort()
  });

  const response = await useCase.execute(startCheckoutRequest({ session_id: "chk_manual" }));

  assert.equal(response.agent_enabled, false);
  assert.equal(response.initial_mode, "silent");
});
