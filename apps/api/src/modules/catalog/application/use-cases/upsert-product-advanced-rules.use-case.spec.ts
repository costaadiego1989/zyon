import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CheckoutSettingsValidationError } from "../../../checkout-settings/domain/checkout-settings.errors.js";
import { CheckoutSettingsEntity } from "../../../checkout-settings/domain/entities/checkout-settings.entity.js";
import type { CheckoutSettingsRepository } from "../../../checkout-settings/domain/ports/checkout-settings-repository.port.js";
import type { AdvancedRule } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";
import type { ProductRepositoryPort } from "../../domain/ports/product-repository.port.js";
import { UpsertProductAdvancedRulesUseCase } from "./upsert-product-advanced-rules.use-case.js";

const merchantId = "merchant_rules";

function rule(overrides: Partial<AdvancedRule> = {}): AdvancedRule {
  return {
    id: "product-rule",
    name: "10% no produto selecionado",
    enabled: true,
    priority: 1,
    conditions: [{ field: "cart_total", operator: "gte", value: 50 }],
    action: { type: "offer_discount", params: { percent: 10 } },
    ...overrides,
  } as AdvancedRule;
}

function product(activeVariants = 1): ProductEntity {
  return new ProductEntity({
    id: "product_1",
    merchantId,
    name: "Produto de teste",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    variants: Array.from({ length: activeVariants }, (_, index) => ({
      id: `variant_${index + 1}`,
      sku: `SKU-${index + 1}`,
      attributes: {},
      isActive: true,
      basePriceInCents: 10_000,
      taxPercent: 0,
      currency: "BRL",
      stockQuantity: 10,
      stockReserved: 0,
      media: [],
    })),
  });
}

class InMemorySettingsRepository implements CheckoutSettingsRepository {
  settings = CheckoutSettingsEntity.createDefault({ merchantId }).snapshot();

  async get() {
    return this.settings;
  }

  async save(settings: typeof this.settings) {
    this.settings = settings;
    return settings;
  }

  async delete() {}
}

function buildUseCase(activeVariants = 1) {
  const settings = new InMemorySettingsRepository();
  const products = {
    findById: async (requestedMerchantId: string, productId: string) =>
      requestedMerchantId === merchantId && productId === "product_1" ? product(activeVariants) : null,
  } as ProductRepositoryPort;
  return { settings, useCase: new UpsertProductAdvancedRulesUseCase(settings, products) };
}

describe("UpsertProductAdvancedRulesUseCase", () => {
  it("uses the merchant-owned route product SKU and persists the scoped rule", async () => {
    const { settings, useCase } = buildUseCase();

    const saved = await useCase.execute({ merchantId, productId: "product_1", rules: [rule()] });

    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].conditions, [
      { field: "cart_total", operator: "gte", value: 50 },
      { field: "product_in_cart", operator: "contains", value: "SKU-1" },
    ]);
    assert.deepEqual(settings.settings.advancedRules, saved);
  });

  it("scopes a product rule to any active variation", async () => {
    const { useCase } = buildUseCase(2);

    const saved = await useCase.execute({ merchantId, productId: "product_1", rules: [rule()] });

    assert.deepEqual(saved[0].conditions.at(-1), {
      field: "product_in_cart",
      operator: "contains",
      value: ["SKU-1", "SKU-2"],
    });
  });

  it("rejects a BOGO-style action that the cart engine cannot execute", async () => {
    const { useCase } = buildUseCase();
    const unsupported = rule({
      action: { type: "buy_one_get_one" as never, params: {} },
    });

    await assert.rejects(
      () => useCase.execute({ merchantId, productId: "product_1", rules: [unsupported] }),
      (error: unknown) => error instanceof CheckoutSettingsValidationError && error.code === "advanced_rule_action_unsupported",
    );
  });
});

it("reloads editable conditions and removes deleted rules while preserving global rules", async () => {
  const { settings, useCase } = buildUseCase(2);
  const global = rule({ id: "global" });
  settings.settings.advancedRules = [global] as typeof settings.settings.advancedRules;
  const authored = rule({ conditions: [
    { field: "cart_item_count", operator: ">=", value: 3 },
    { field: "product_in_cart", operator: "contains", value: "COMPLEMENT" },
  ] });
  await useCase.execute({ merchantId, productId: "product_1", rules: [authored] });
  const editable = await useCase.get(merchantId, "product_1");
  assert.deepEqual(editable[0].conditions, authored.conditions);
  assert.equal(settings.settings.advancedRules[1].conditions.length, 3);
  await useCase.execute({ merchantId, productId: "product_1", rules: [] });
  assert.deepEqual(settings.settings.advancedRules, [global]);
  assert.deepEqual(await useCase.get(merchantId, "product_1"), []);
});

it("rejects replacement of another product or global rule by reused id", async () => {
  const { settings, useCase } = buildUseCase();
  settings.settings.advancedRules = [rule({ id: "global" })] as typeof settings.settings.advancedRules;
  await assert.rejects(() => useCase.execute({ merchantId, productId: "product_1", rules: [rule({ id: "global" })] }), /product_rule_id_conflict/);
  assert.equal(settings.settings.advancedRules.length, 1);
});

it("preserves authored conditions when the global editor reorders the automatic scope", async () => {
  const { settings, useCase } = buildUseCase();
  const authored = rule();
  await useCase.execute({ merchantId, productId: "product_1", rules: [authored] });
  settings.settings.advancedRules[0].conditions.reverse();
  assert.deepEqual((await useCase.get(merchantId, "product_1"))[0].conditions, authored.conditions);
});
