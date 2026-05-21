import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { UpdateOrderTrackingUseCase } from "../../checkout/application/use-cases/update-order-tracking.use-case.js";
import { InMemoryIntegrationsRepository } from "../infrastructure/in-memory-integrations.repository.js";
import {
  CreateMerchantApiKeyUseCase,
  ListWebhookDeliveriesUseCase,
  TenantWebhookPublisher,
  UpdateTenantOrderTrackingUseCase,
  UpsertWebhookEndpointUseCase
} from "./integrations.use-cases.js";
import { ApiKeyService } from "../domain/api-key.service.js";

test("CreateMerchantApiKeyUseCase returns the raw secret once and stores only hashed metadata", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const useCase = new CreateMerchantApiKeyUseCase(repo, new ApiKeyService());

  const created = await useCase.execute({ merchantId: "mrc_1", name: "ERP", scopes: ["orders:tracking:write"] });
  assert.match(created.secret_key, /^aacp_sk_/);
  assert.equal(created.api_key.name, "ERP");
  assert.equal(created.api_key.scopes.includes("orders:tracking:write"), true);

  const stored = await repo.findActiveApiKeyByHash(new ApiKeyService().hash(created.secret_key));
  assert.equal(stored?.keyHash, new ApiKeyService().hash(created.secret_key));
  assert.equal((stored as any).secret_key, undefined);
});

test("UpdateTenantOrderTrackingUseCase updates completed order, persists shipment timeline and enqueues webhook", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const integrations = new InMemoryIntegrationsRepository();
  const publisher = new TenantWebhookPublisher(integrations);
  const now = new Date("2026-05-21T12:00:00.000Z").toISOString();

  checkout.saveSession({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    globalUserId: "usr_1",
    conversationId: "cnv_1",
    cart: {
      currency: "BRL",
      total: 219,
      currentDiscount: 10,
      items: [{ sku: "sku_1", name: "Premium Kit", price: 109.5, quantity: 2 }]
    },
    customer: { email: "ana@example.com", fullName: "Ana Cliente", phone: "+5511999999999" },
    shipping: { customerPrice: 19, carrier: "Correios", method: "PAC", deliveryDays: 5 },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: now,
    updatedAt: now
  });

  await new CompleteOrderUseCase(checkout, checkout, checkout).execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    external_order_id: "ord_900",
    order_total: 219,
    currency: "BRL"
  });

  await new UpsertWebhookEndpointUseCase(integrations).execute({
    merchantId: "mrc_1",
    url: "https://example.com/aacp/webhooks",
    events: ["order.tracking.updated"]
  });

  const useCase = new UpdateTenantOrderTrackingUseCase(
    integrations,
    checkout,
    checkout,
    new UpdateOrderTrackingUseCase(checkout, checkout, checkout),
    publisher
  );

  const result = await useCase.execute({
    context: { id: "mak_1", merchantId: "mrc_1", scopes: ["orders:tracking:write"] },
    externalOrderId: "ord_900",
    body: {
      tracking_code: " BR123456789AA ",
      carrier: "Correios",
      tracking_url: "https://rastreamento.correios.com.br/BR123456789AA",
      status: "in_transit",
      events: [
        {
          status: "in_transit",
          description: "Objeto em transferencia",
          location: "Sao Paulo, SP",
          occurred_at: "2026-05-21T13:00:00.000Z"
        }
      ]
    }
  });

  assert.equal(result.updated, true);
  assert.equal(result.changed, true);
  assert.equal(result.order.trackingCode, "BR123456789AA");
  assert.equal(result.shipment.trackingCode, "BR123456789AA");
  assert.equal(result.events_recorded, 1);

  const deliveries = await new ListWebhookDeliveriesUseCase(integrations).execute("mrc_1");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.eventType, "order.tracking.updated");
  assert.equal(deliveries[0]?.status, "pending");
});
