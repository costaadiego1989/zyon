import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InMemoryIntegrationsRepository } from "../../../infrastructure/in-memory-integrations.repository.js";
import { TestWebhookEndpointUseCase } from "./test-webhook-endpoint.use-case.js";
import { TenantWebhookPublisher } from "./tenant-webhook-publisher.js";

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
