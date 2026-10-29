import { test } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { ApiKeyAccessPolicy } from "./api-key-access-policy.js";
import { ApiKeyService } from "./api-key.service.js";
import { WebhookSignatureService } from "./webhook-signature.service.js";

test("ApiKeyService generates one-time secret metadata and stable hashes", () => {
  const service = new ApiKeyService();
  const generated = service.generate("test");

  assert.match(generated.rawKey, /^aacp_test_/);
  assert.equal(generated.keyHash, service.hash(generated.rawKey));
  assert.equal(generated.keyPrefix, generated.rawKey.slice(0, 18));
  assert.notEqual(generated.keyHash, generated.rawKey);
  assert.equal(service.environment(generated.rawKey), "test");
  assert.equal(service.environment(service.generate("live").rawKey), "live");
  assert.equal(service.environment("aacp_sk_legacy"), "legacy");
});

test("ApiKeyAccessPolicy normalizes CIDRs and blocks disallowed source IPs", () => {
  const policy = new ApiKeyAccessPolicy();
  const cidrs = policy.normalizeCidrs(["203.0.113.10", "2001:db8::/48"]);

  assert.deepEqual(cidrs, ["203.0.113.10/32", "2001:db8:0:0:0:0:0:0/48"]);
  assert.doesNotThrow(() => policy.assertClientIpAllowed(cidrs, "203.0.113.10"));
  assert.throws(
    () => policy.assertClientIpAllowed(cidrs, "198.51.100.20"),
    ForbiddenException,
  );
});

test("WebhookSignatureService signs timestamp plus raw body and rejects tampering", () => {
  const service = new WebhookSignatureService();
  const input = {
    secret: "whsec_test",
    timestamp: "1779364800",
    body: JSON.stringify({ event_id: "evt_1", data: { ok: true } })
  };

  const signature = service.sign(input);
  assert.match(signature, /^sha256=/);
  assert.equal(service.verify({ ...input, signature }), true);
  assert.equal(service.verify({ ...input, body: JSON.stringify({ ok: false }), signature }), false);
});
