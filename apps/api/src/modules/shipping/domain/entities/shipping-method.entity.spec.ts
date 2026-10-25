import test from "node:test";
import assert from "node:assert/strict";
import { ShippingMethodEntity } from "./shipping-method.entity.js";

test("ShippingMethodEntity.create assigns id and timestamps", () => {
  const before = new Date().toISOString();
  const method = ShippingMethodEntity.create({
    merchant_id: "mrc_1",
    carrier_key: "pac",
    label: "Correios PAC",
    estimated_days_min: 5,
    estimated_days_max: 8,
    is_active: true,
    config: { foo: "bar" }
  });
  const after = new Date().toISOString();

  const snap = method.snapshot();
  assert.ok(snap.id.length > 0, "id is generated");
  assert.equal(snap.merchant_id, "mrc_1");
  assert.equal(snap.carrier_key, "pac");
  assert.equal(snap.label, "Correios PAC");
  assert.equal(snap.estimated_days_min, 5);
  assert.equal(snap.estimated_days_max, 8);
  assert.equal(snap.is_active, true);
  assert.deepEqual(snap.config, { foo: "bar" });
  assert.ok(snap.created_at >= before && snap.created_at <= after);
  assert.equal(snap.updated_at, snap.created_at);
});

test("ShippingMethodEntity.update patches allowed fields and updates updated_at", async () => {
  const created = ShippingMethodEntity.create({
    merchant_id: "mrc_1",
    carrier_key: "pac",
    label: "PAC",
    estimated_days_min: 5,
    estimated_days_max: 8,
    is_active: true,
    config: {}
  });
  const createdAt = created.snapshot().created_at;

  // force updated_at change to be observable
  await new Promise((r) => setTimeout(r, 5));

  const updated = created.update({
    label: "PAC v2",
    estimated_days_min: 3,
    estimated_days_max: 6,
    is_active: false,
    config: { kind: "express" }
  });

  const snap = updated.snapshot();
  assert.equal(snap.label, "PAC v2");
  assert.equal(snap.estimated_days_min, 3);
  assert.equal(snap.estimated_days_max, 6);
  assert.equal(snap.is_active, false);
  assert.deepEqual(snap.config, { kind: "express" });
  assert.equal(snap.created_at, createdAt, "created_at is immutable on update");
  assert.notEqual(snap.updated_at, createdAt, "updated_at advances on update");
  assert.ok(snap.updated_at > createdAt);
});

test("ShippingMethodEntity.rehydrate reproduces same snapshot", () => {
  const original = ShippingMethodEntity.create({
    merchant_id: "mrc_1",
    carrier_key: "pac",
    label: "PAC",
    estimated_days_min: 5,
    estimated_days_max: 8,
    is_active: true,
    config: {}
  });
  const rehydrated = ShippingMethodEntity.rehydrate(original.snapshot());
  assert.deepEqual(rehydrated.snapshot(), original.snapshot());
});

test("ShippingMethodEntity getters expose id, merchant_id, carrier_key", () => {
  const method = ShippingMethodEntity.create({
    merchant_id: "mrc_1",
    carrier_key: "sedex",
    label: "Sedex",
    estimated_days_min: 1,
    estimated_days_max: 2,
    is_active: true,
    config: {}
  });
  assert.equal(method.id, method.snapshot().id);
  assert.equal(method.merchant_id, "mrc_1");
  assert.equal(method.carrier_key, "sedex");
});
