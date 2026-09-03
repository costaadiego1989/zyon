import test from "node:test";
import assert from "node:assert/strict";
import { UcpDiscoveryController } from "./ucp-discovery.controller.js";

test("UcpDiscoveryController returns /.well-known/ucp discovery metadata", async () => {
  const controller = new UcpDiscoveryController();
  const result = await controller.discovery();

  assert.equal(result.version, "1.0");
  assert.equal(result.name, "AACP");
  assert.equal(result.merchant_id, "platform-default");
  assert.deepEqual(result.capabilities, ["checkout", "product_discovery", "payment"]);
  assert.deepEqual(result.supported_protocols, ["acp", "ucp", "ap2"]);
  assert.equal(result.checkout_sessions_endpoint, "/v1/acp/checkout_sessions");
  assert.equal(result.feed_endpoint, "/v1/acp/products/feed");
  assert.equal(result.webhook_endpoint, "/v1/acp/webhooks");
  assert(result.created_at);
  assert(new Date(result.created_at).getTime() > 0);
});

test("UcpDiscoveryController response has all required fields", async () => {
  const controller = new UcpDiscoveryController();
  const result = await controller.discovery();

  const requiredFields = [
    "version",
    "name",
    "merchant_id",
    "capabilities",
    "supported_protocols",
    "checkout_sessions_endpoint",
    "feed_endpoint",
    "webhook_endpoint",
    "created_at",
  ];

  for (const field of requiredFields) {
    assert(field in result, `Missing required field: ${field}`);
    assert(
      result[field as keyof typeof result] !== undefined,
      `Field ${field} is undefined`
    );
    assert(
      result[field as keyof typeof result] !== null,
      `Field ${field} is null`
    );
  }
});

test("UcpDiscoveryController returns valid ISO 8601 timestamp", async () => {
  const controller = new UcpDiscoveryController();
  const result = await controller.discovery();

  const timestamp = new Date(result.created_at);
  assert(!isNaN(timestamp.getTime()), `created_at is not a valid ISO 8601 timestamp: ${result.created_at}`);
  assert(timestamp.getTime() > 0);
});
