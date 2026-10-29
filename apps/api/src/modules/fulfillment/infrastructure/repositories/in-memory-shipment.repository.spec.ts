import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryShipmentRepository } from "./in-memory-shipment.repository.js";
import { ShipmentEntity } from "../../domain/entities/shipment.entity.js";

const BASE = { merchant_id: "mrc_1", order_id: "ord_1", carrier_key: "correios" };

describe("InMemoryShipmentRepository", () => {
  it("save() then findById() returns the same entity for matching merchant", async () => {
    const repo = new InMemoryShipmentRepository();
    const s = ShipmentEntity.create(BASE);
    await repo.save(s);

    const fetched = await repo.findById(s.id, "mrc_1");
    assert.ok(fetched);
    assert.equal(fetched!.id, s.id);
  });

  it("findById() returns null for unknown id", async () => {
    const repo = new InMemoryShipmentRepository();
    assert.equal(await repo.findById("missing", "mrc_1"), null);
  });

  it("tenant boundary: findById() returns null for wrong merchant", async () => {
    const repo = new InMemoryShipmentRepository();
    const s = ShipmentEntity.create(BASE);
    await repo.save(s);

    assert.equal(await repo.findById(s.id, "mrc_other"), null);
  });

  it("findByOrderId() returns matching shipment scoped by merchant", async () => {
    const repo = new InMemoryShipmentRepository();
    const a = ShipmentEntity.create({ ...BASE, merchant_id: "mrc_1", order_id: "ord_a" });
    const b = ShipmentEntity.create({ ...BASE, merchant_id: "mrc_2", order_id: "ord_a" });
    await repo.save(a);
    await repo.save(b);

    const fa = await repo.findByOrderId("ord_a", "mrc_1");
    const fb = await repo.findByOrderId("ord_a", "mrc_2");
    assert.equal(fa?.id, a.id);
    assert.equal(fb?.id, b.id);
  });

  it("findByOrderId() returns null when no match", async () => {
    const repo = new InMemoryShipmentRepository();
    assert.equal(await repo.findByOrderId("ord_nope", "mrc_1"), null);
  });

  it("findByTrackingCode() requires tracking code to be set", async () => {
    const repo = new InMemoryShipmentRepository();
    const s = ShipmentEntity.create(BASE);
    await repo.save(s);

    assert.equal(await repo.findByTrackingCode("nope", "mrc_1"), null);
  });

  it("findByTrackingCode() returns shipment when label set and merchant matches", async () => {
    const repo = new InMemoryShipmentRepository();
    const s = ShipmentEntity.create(BASE).setLabel("http://track.example.com/1", "T-1");
    await repo.save(s);

    const found = await repo.findByTrackingCode("T-1", "mrc_1");
    assert.ok(found);
    assert.equal(found!.id, s.id);
  });

  it("tenant boundary: findByTrackingCode() does not return other merchants", async () => {
    const repo = new InMemoryShipmentRepository();
    const s = ShipmentEntity.create(BASE).setLabel("http://track.example.com/1", "T-1");
    await repo.save(s);

    assert.equal(await repo.findByTrackingCode("T-1", "mrc_other"), null);
  });

  it("save() overwrites existing entry by id", async () => {
    const repo = new InMemoryShipmentRepository();
    const s = ShipmentEntity.create(BASE);
    await repo.save(s);

    const advanced = s.transition("label_generated");
    await repo.save(advanced);

    const fetched = await repo.findById(s.id, "mrc_1");
    assert.equal(fetched?.status, "label_generated");
  });
});
