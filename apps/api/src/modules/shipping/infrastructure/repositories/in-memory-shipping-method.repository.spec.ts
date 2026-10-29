import test from "node:test";
import assert from "node:assert/strict";
import { ShippingMethodEntity } from "../../domain/entities/shipping-method.entity.js";
import { InMemoryShippingMethodRepository } from "./in-memory-shipping-method.repository.js";

function make(overrides: Partial<{ merchant_id: string; carrier_key: string; label: string }> = {}) {
  return ShippingMethodEntity.create({
    merchant_id: overrides.merchant_id ?? "mrc_1",
    carrier_key: overrides.carrier_key ?? "pac",
    label: overrides.label ?? "PAC",
    estimated_days_min: 5,
    estimated_days_max: 8,
    is_active: true,
    config: {}
  });
}

test("InMemoryShippingMethodRepository.save persists and findByCarrierKey roundtrips", async () => {
  const repo = new InMemoryShippingMethodRepository();
  const m = make();
  await repo.save(m);

  const found = await repo.findByCarrierKey("mrc_1", "pac");
  assert.ok(found);
  assert.equal(found!.id, m.id);
  assert.equal(found!.carrier_key, "pac");
});

test("InMemoryShippingMethodRepository.findByCarrierKey returns null when missing", async () => {
  const repo = new InMemoryShippingMethodRepository();
  const found = await repo.findByCarrierKey("mrc_1", "missing");
  assert.equal(found, null);
});

test("InMemoryShippingMethodRepository key includes merchant (no cross-tenant leakage)", async () => {
  const repo = new InMemoryShippingMethodRepository();
  await repo.save(make({ merchant_id: "mrc_1", carrier_key: "pac" }));

  const sameMerchant = await repo.findByCarrierKey("mrc_1", "pac");
  const otherMerchant = await repo.findByCarrierKey("mrc_2", "pac");
  assert.ok(sameMerchant);
  assert.equal(otherMerchant, null);
});

test("InMemoryShippingMethodRepository.findAllByMerchant returns only that merchant's methods", async () => {
  const repo = new InMemoryShippingMethodRepository();
  await repo.save(make({ merchant_id: "mrc_1", carrier_key: "pac" }));
  await repo.save(make({ merchant_id: "mrc_1", carrier_key: "sedex" }));
  await repo.save(make({ merchant_id: "mrc_2", carrier_key: "pac" }));

  const mine = await repo.findAllByMerchant("mrc_1");
  const others = await repo.findAllByMerchant("mrc_2");

  assert.equal(mine.length, 2);
  assert.equal(others.length, 1);
  for (const m of mine) assert.equal(m.merchant_id, "mrc_1");
});

test("InMemoryShippingMethodRepository.save overwrites by (merchant_id, carrier_key)", async () => {
  const repo = new InMemoryShippingMethodRepository();
  const first = make({ label: "Original" });
  await repo.save(first);

  const updated = first.update({ label: "Patched" });
  await repo.save(updated);

  const all = await repo.findAllByMerchant("mrc_1");
  assert.equal(all.length, 1, "no duplicate key per merchant");
  assert.equal(all[0]!.snapshot().label, "Patched");
});
