import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { RealtimeCapabilityService, realtimeRoom } from "./realtime-capability.js";

const secret = "test-realtime-secret-at-least-32-characters";
const service = new RealtimeCapabilityService(secret);
const input = { purpose: "support-ticket" as const, merchantId: "merchant_a", resourceId: "ticket_a", origin: "https://shop.example" };

test("realtime capability binds purpose, tenant, resource, origin and strict expiry", () => {
  const issued = service.issue(input, 1000);
  assert.equal(service.verify(issued.token, input.purpose, input.origin, 1001).resourceId, "ticket_a");
  assert.throws(() => service.verify(issued.token, "storefront-conversation", input.origin, 1001));
  assert.throws(() => service.verify(issued.token, input.purpose, "https://evil.example", 1001));
  assert.throws(() => service.verify(issued.token, input.purpose, undefined, 1001));
  assert.throws(() => service.verify(issued.token, input.purpose, input.origin, issued.expiresAt));
  assert.throws(() => service.verify(issued.token, input.purpose, input.origin, 999));
  const [payload, signature] = issued.token.split(".");
  const tampered = JSON.parse(Buffer.from(payload!, "base64url").toString());
  tampered.merchantId = "merchant_b";
  assert.throws(() => service.verify(`${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${signature}`, input.purpose, input.origin, 1001));
});

test("realtime capability rejects correctly signed malformed or unbounded claims", () => {
  const issued = service.issue(input, 1000);
  const original = JSON.parse(Buffer.from(issued.token.split(".")[0]!, "base64url").toString());
  for (const change of [
    { expiresAt: null }, { expiresAt: "4600" }, { expiresAt: 9000 }, { issuedAt: null },
    { merchantId: "" }, { resourceId: "ticket:a" }, { nonce: null }, { typ: "aacp_embed_v1" },
    { origin: "null" }, { origin: "https://shop.example/path" },
  ]) {
    const payload = Buffer.from(JSON.stringify({ ...original, ...change })).toString("base64url");
    const signature = createHmac("sha256", secret).update(`aacp_realtime_v1:${payload}`).digest("base64url");
    assert.throws(() => service.verify(`${payload}.${signature}`, input.purpose, input.origin, 1001));
  }
  for (const token of [undefined, null, {}, "", "a.b.c", "a.==", "a".repeat(5000)]) {
    assert.throws(() => service.verify(token, input.purpose, input.origin, 1001));
  }
});

test("no predictable secret fallback and no room collision across tenants", () => {
  assert.throws(() => new RealtimeCapabilityService(""));
  assert.throws(() => new RealtimeCapabilityService("dev-secret-change-me"));
  assert.notEqual(realtimeRoom("ticket", "a", "same"), realtimeRoom("ticket", "b", "same"));
  assert.notEqual(realtimeRoom("ticket", "a:b", "c"), realtimeRoom("ticket", "a", "b:c"));
});
