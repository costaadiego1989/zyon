import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiKeyService } from "./api-key.service.js";
import { WebhookSignatureService } from "./webhook-signature.service.js";

test("ApiKeyService generates one-time secret metadata and stable hashes", () => {
  const service = new ApiKeyService();
  const generated = service.generate();

  assert.match(generated.rawKey, /^aacp_sk_/);
  assert.equal(generated.keyHash, service.hash(generated.rawKey));
  assert.equal(generated.keyPrefix, generated.rawKey.slice(0, 18));
  assert.notEqual(generated.keyHash, generated.rawKey);
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
