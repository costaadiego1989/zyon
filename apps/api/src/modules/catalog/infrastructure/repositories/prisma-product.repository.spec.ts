import assert from "node:assert/strict";
import test from "node:test";
import { assertCatalogBusinessMode } from "../../../../shared/persistence/catalog-business-mode.js";

test("T17", async t => {
  const merchant: { businessMode: "products" | "services"; businessModeSelectedAt: Date | null; businessModeNeedsReview: boolean; storeSettings: Record<string, unknown> } = { businessMode: "products", businessModeSelectedAt: new Date(), businessModeNeedsReview: false, storeSettings: {} };
  const facts = (overrides: Partial<typeof merchant> = {}, legacy = 0) => ({
    merchant: { findUnique: async () => ({ ...merchant, ...overrides }) },
    product: { count: async () => legacy },
    serviceReservation: { count: async () => 0 },
  });
  await t.test("products preserve physical, digital and food offers", async () => {
    for (const type of ["physical", "digital", "food"]) assert.equal(await assertCatalogBusinessMode(facts() as never, "merchant", type), undefined);
    await assert.rejects(assertCatalogBusinessMode(facts() as never, "merchant", "service"), /catalog_business_mode_conflict/);
  });
  await t.test("services accept only service offers without requiring booking activation", async () => {
    const tx = facts({ businessMode: "services" });
    assert.equal(await assertCatalogBusinessMode(tx as never, "merchant", "service"), undefined);
    for (const type of ["physical", "digital", "food"]) await assert.rejects(assertCatalogBusinessMode(tx as never, "merchant", type), /catalog_business_mode_conflict/);
  });
  await t.test("legacy service and mixed offers require classification", async () => {
    for (const overrides of [{ businessModeNeedsReview: true }, { businessModeSelectedAt: null }, { businessModeSelectedAt: null, businessMode: "services" }]) {
      await assert.rejects(assertCatalogBusinessMode(facts(overrides as never, 1) as never, "merchant", "service"), /business_mode_classification_required/);
    }
    assert.equal(await assertCatalogBusinessMode(facts({ businessModeSelectedAt: null } as never) as never, "merchant", "physical"), undefined);
    await assert.rejects(assertCatalogBusinessMode({ ...facts({ businessModeSelectedAt: null } as never), serviceReservation: { count: async () => 1 } } as never, "merchant", "physical"), /business_mode_classification_required/);
  });
  await t.test("unknown tenant or offer type cannot bypass the guard", async () => {
    await assert.rejects(assertCatalogBusinessMode({ merchant: { findUnique: async () => null } } as never, "foreign", "physical"), /merchant_not_found/);
    await assert.rejects(assertCatalogBusinessMode(facts() as never, "merchant", "unknown"), /invalid_product_type/);
  });
  await t.test("canonical pending signup requires a choice while ordinary legacy products remain allowed", async () => {
    for (const flag of ["registration_pending", "oauth_registration_pending"]) await assert.rejects(assertCatalogBusinessMode(facts({ businessModeSelectedAt: null, storeSettings: { [flag]: true } }) as never, "merchant", "physical"), /business_mode_selection_required/);
    assert.equal(await assertCatalogBusinessMode(facts({ businessModeSelectedAt: null, storeSettings: {} }) as never, "merchant", "physical"), undefined);
  });
});
