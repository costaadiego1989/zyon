import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InMemoryIntegrationsRepository } from "../../../infrastructure/in-memory-integrations.repository.js";
import { TestWebhookEndpointUseCase } from "./test-webhook-endpoint.use-case.js";
import { TenantWebhookPublisher } from "./tenant-webhook-publisher.js";
import { WebhookEndpointsController } from "../../../presentation/http/webhook-endpoints.controller.js";
import { WebhooksV1Controller } from "../../../../public-api/webhooks/presentation/http/webhooks-v1.controller.js";

async function fixture() {
  const repo = new InMemoryIntegrationsRepository();
  for (const [id, merchantId, enabled] of [["selected", "merchant-a", true], ["other", "merchant-a", true], ["foreign", "merchant-b", true], ["paused", "merchant-a", false]] as const) {
    await repo.upsertWebhookEndpoint({ id, merchantId, enabled, events: ["customer.upserted"], url: "https://example.test/" + id,
      signingSecret: "local-test-secret", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() });
  }
  const publisher = new TenantWebhookPublisher(repo);
  return { repo, publisher, useCase: new TestWebhookEndpointUseCase(repo, publisher) };
}
test("selected subscribed webhook event persists one pending delivery without broadcasting", async () => {
  const { repo, useCase } = await fixture();
  const result = await useCase.execute("merchant-a", "selected", "customer.upserted");
  const records = await repo.listWebhookDeliveries("merchant-a"); assert.equal(records.length, 1);
  const saved = records[0];
  assert.equal(result.id, saved.id); assert.equal(result.status, "pending"); assert.equal(result.eventType, "customer.upserted");
  assert.equal(saved.merchantId, "merchant-a"); assert.equal(saved.endpointId, "selected"); assert.equal(saved.endpointUrl, "https://example.test/selected");
  assert.equal(saved.envelope.event_type, "customer.upserted"); assert.equal(saved.envelope.merchant_id, "merchant-a");
  assert.equal(saved.envelope.data.test, true); assert.equal(saved.attempts, 0); assert.equal((await repo.listWebhookDeliveries("merchant-b")).length, 0);
});
for (const [endpoint, event, exception] of [["foreign", "customer.upserted", NotFoundException], ["paused", "customer.upserted", BadRequestException],
  ["selected", "order.approved", BadRequestException], ["selected", "unknown.event", BadRequestException]] as const) {
  test(`webhook test rejects ${endpoint}/${event} before queuing`, async () => {
    const { repo, useCase } = await fixture();
    await assert.rejects(useCase.execute("merchant-a", endpoint, event), exception);
    assert.deepEqual(await repo.listWebhookDeliveries("merchant-a"), []); assert.deepEqual(await repo.listWebhookDeliveries("merchant-b"), []);
  });
}
test("normal webhook publication retains subscribed endpoint fanout", async () => {
  const { publisher, repo } = await fixture();
  await publisher.publish({ merchantId: "merchant-a", eventType: "customer.upserted", data: { customer: { id: "customer-a" } } });
  assert.deepEqual((await repo.listWebhookDeliveries("merchant-a")).map(item => item.endpointId).sort(), ["other", "selected"]);
});

for (const route of ["dashboard", "public"] as const) {
  test(`${route} webhook controller forwarding preserves selected event and scoped pending delivery`, async () => {
    const { repo, useCase } = await fixture();
    const unused = undefined as never;
    const controller = route === "dashboard"
      ? new WebhookEndpointsController(unused, unused, unused, unused, unused, useCase, unused, unused, unused, unused)
      : new WebhooksV1Controller(unused, unused, unused, unused, useCase, unused, unused);
    const request = { tenantPrincipal: { kind: "human" as const, tenantId: "merchant-a", userId: "qa-owner", email: "qa@example.test", role: "owner" as const } };
    const response = await controller.test(request, "selected", { event_type: "customer.upserted" });
    assert.equal(response.event_type, "customer.upserted");
    if (route === "dashboard") { assert.ok("endpoint_id" in response); assert.equal(response.endpoint_id, "selected"); }
    else { assert.ok("webhook_id" in response); assert.equal(response.webhook_id, "selected"); }
    assert.equal(response.status, "pending");
    const records = await repo.listWebhookDeliveries("merchant-a");
    assert.equal(records.length, 1); assert.equal(records[0].id, response.id);
    assert.equal(records[0].merchantId, "merchant-a"); assert.equal(records[0].endpointId, "selected");
    assert.equal(records[0].envelope.event_type, "customer.upserted");
    assert.equal(records[0].envelope.merchant_id, "merchant-a"); assert.equal(records[0].envelope.data.test, true);
    await assert.rejects(controller.test(request, "foreign", { event_type: "customer.upserted" }), NotFoundException);
    await assert.rejects(controller.test(request, "selected", { event_type: "order.approved" }), BadRequestException);
    assert.equal((await repo.listWebhookDeliveries("merchant-a")).length, 1);
    assert.deepEqual(await repo.listWebhookDeliveries("merchant-b"), []);
  });
}
