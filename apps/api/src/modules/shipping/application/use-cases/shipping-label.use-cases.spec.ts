import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PurchaseShippingLabelUseCase, GetShippingTrackingUseCase } from "./shipping-label.use-cases.js";
import type { MelhorEnvioCarrierAdapter } from "../../infrastructure/adapters/melhor-envio.carrier.js";
import { ShipmentEntity } from "../../../fulfillment/domain/entities/shipment.entity.js";
import type { ShipmentRepository } from "../../../fulfillment/domain/ports/shipment-repository.port.js";

const labelInput = {
  merchantId: "mrc_a",
  externalOrderId: "external_1",
  serviceId: 1,
  fromZip: "01000-000",
  toZip: "01310-100",
  toName: "Buyer",
  toDocument: "12345678900",
  packages: [{ weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 20, quantity: 1 }],
};

describe("PurchaseShippingLabelUseCase", () => {
  it("purchases Melhor Envio label, updates order tracking, and returns shipment data", async () => {
    const trackingUpdates: unknown[] = [];
    const useCase = new PurchaseShippingLabelUseCase(
      {
        purchaseLabel: async () => ({ purchaseId: "purchase_1", trackingCode: "ME123", labelUrl: "https://label.test/me123.pdf" }),
      } as unknown as MelhorEnvioCarrierAdapter,
      {
        assertOrderExists: async () => undefined,
        execute: async (input: unknown) => {
          trackingUpdates.push(input);
          return { updated: true, changed: true, order: {}, shipment: {}, events_recorded: 0 } as any;
        },
      } as any,
    );

    const result = await useCase.execute(labelInput);

    assert.equal(result.tracking_code, "ME123");
    assert.equal(result.label_url, "https://label.test/me123.pdf");
    assert.equal(result.purchase_id, "purchase_1");
    assert.equal(trackingUpdates.length, 1);
    assert.equal((trackingUpdates[0] as { externalOrderId: string }).externalOrderId, "external_1");
  });

  it("rejects missing order id", async () => {
    const useCase = new PurchaseShippingLabelUseCase({} as MelhorEnvioCarrierAdapter, { assertOrderExists: async () => undefined, execute: async () => ({}) } as any);
    await assert.rejects(
      useCase.execute({ ...labelInput, externalOrderId: "" }),
      BadRequestException,
    );
  });

  it("verifies the tenant order before charging the carrier", async () => {
    let purchases = 0;
    const useCase = new PurchaseShippingLabelUseCase(
      { purchaseLabel: async () => { purchases++; return { purchaseId: "unexpected", trackingCode: "unexpected" }; } } as unknown as MelhorEnvioCarrierAdapter,
      {
        assertOrderExists: async () => { throw new NotFoundException("completed_order_not_found"); },
        execute: async () => ({}) as any,
      },
    );

    await assert.rejects(useCase.execute(labelInput), NotFoundException);
    assert.equal(purchases, 0);
  });
});

describe("GetShippingTrackingUseCase", () => {
  it("loads shipment tenant-scoped and fetches tracking status", async () => {
    const shipment = ShipmentEntity.create({ merchant_id: "mrc_a", order_id: "external_1", carrier_key: "melhor-envio" })
      .setLabel("https://label.test/me123.pdf", "ME123");
    const repo = new FakeShipmentRepository(shipment);
    const useCase = new GetShippingTrackingUseCase(repo, {
      getTracking: async (trackingCode: string) => ({ status: "delivered", events: [{ status: "delivered", date: "2026-07-18", description: "Entregue" }] }),
    } as unknown as MelhorEnvioCarrierAdapter);

    const result = await useCase.execute({ merchantId: "mrc_a", shipmentId: shipment.id });

    assert.equal(result.shipment_id, shipment.id);
    assert.equal(result.tracking_code, "ME123");
    assert.equal(result.status, "delivered");
    assert.equal(result.events.length, 1);
  });

  it("rejects shipment from another tenant", async () => {
    const shipment = ShipmentEntity.create({ merchant_id: "mrc_a", order_id: "external_1", carrier_key: "melhor-envio" })
      .setLabel("https://label.test/me123.pdf", "ME123");
    const useCase = new GetShippingTrackingUseCase(new FakeShipmentRepository(shipment), {
      getTracking: async () => ({ status: "delivered", events: [] }),
    } as unknown as MelhorEnvioCarrierAdapter);

    await assert.rejects(
      useCase.execute({ merchantId: "mrc_b", shipmentId: shipment.id }),
      NotFoundException,
    );
  });
});

class FakeShipmentRepository implements ShipmentRepository {
  constructor(private readonly shipment: ShipmentEntity) {}

  async save() {}

  async findById(id: string, merchantId: string) {
    const snapshot = this.shipment.snapshot();
    return id === snapshot.id && merchantId === snapshot.merchant_id ? this.shipment : null;
  }

  async findByOrderId() {
    return null;
  }

  async listByMerchant() {
    return { data: [], nextCursor: null };
  }

  async findByTrackingCode() {
    return null;
  }

  async findByCarrierTrackingCode() {
    return null;
  }
}

