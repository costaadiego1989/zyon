import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AcpWebhookSubscriptionEntity,
  generatePlaintextSecret,
  hashSecret,
} from "./acp-webhook-subscription.entity.js";

test("register produces a subscription with hash-stored secret", () => {
  const { entity, plaintextSecret } = AcpWebhookSubscriptionEntity.register({
    merchantId: "mrc_a",
    url: "https://a.example.com/h",
    events: ["order.created"],
  });

  assert.match(plaintextSecret, /^whsec_/);
  assert.notEqual(entity.secretHash, plaintextSecret);
  assert.equal(entity.secretHash, hashSecret(plaintextSecret));
  assert.match(entity.id, /^sub_/);
  assert.equal(entity.merchantId, "mrc_a");
  assert.equal(entity.url, "https://a.example.com/h");
  assert.deepEqual(entity.events, ["order.created"]);
});

test("matchesSecretHash verifies plaintext against hash (constant-time semantics)", () => {
  const { entity, plaintextSecret } = AcpWebhookSubscriptionEntity.register({
    merchantId: "mrc_a",
    url: "https://a.example.com/h",
    events: ["order.created"],
  });

  assert.equal(entity.matchesSecretHash(plaintextSecret), true);
  assert.equal(entity.matchesSecretHash("whsec_wrong"), false);
  assert.equal(entity.matchesSecretHash(""), false);
});

test("toPublic hides the secret and toCreated exposes it once", () => {
  const { entity, plaintextSecret } = AcpWebhookSubscriptionEntity.register({
    merchantId: "mrc_a",
    url: "https://a.example.com/h",
    events: ["order.created"],
  });

  const pub = entity.toPublic();
  assert.equal(pub.subscription_id, entity.id);
  assert.equal((pub as { secret?: string }).secret, undefined);

  const created = entity.toCreated(plaintextSecret);
  assert.equal(created.secret, plaintextSecret);
  assert.equal(created.subscription_id, entity.id);
});

test("events getter returns a defensive copy", () => {
  const { entity } = AcpWebhookSubscriptionEntity.register({
    merchantId: "mrc_a",
    url: "https://a.example.com/h",
    events: ["order.created", "order.updated"],
  });

  const first = entity.events;
  first.push("order.fulfilled");
  const second = entity.events;
  assert.equal(second.length, 2);
});

test("generatePlaintextSecret returns whsec_ prefixed random token", () => {
  const a = generatePlaintextSecret();
  const b = generatePlaintextSecret();
  assert.match(a, /^whsec_[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

test("hashSecret produces deterministic sha256 hex", () => {
  const plain = "whsec_unit_test";
  const expected = createHash("sha256").update(plain).digest("hex");
  assert.equal(hashSecret(plain), expected);
  assert.equal(hashSecret(plain).length, 64);
});

test("rehydrate preserves entity identity for round-trip", () => {
  const { entity, plaintextSecret } = AcpWebhookSubscriptionEntity.register({
    merchantId: "mrc_a",
    url: "https://a.example.com/h",
    events: ["order.fulfilled"],
    now: "2026-01-01T00:00:00.000Z",
  });

  const rehydrated = AcpWebhookSubscriptionEntity.rehydrate({
    id: entity.id,
    merchantId: entity.merchantId,
    url: entity.url,
    events: entity.events,
    secretHash: entity.secretHash,
    createdAt: entity.createdAt,
  });

  assert.equal(rehydrated.id, entity.id);
  assert.equal(rehydrated.merchantId, entity.merchantId);
  assert.equal(rehydrated.url, entity.url);
  assert.deepEqual(rehydrated.events, entity.events);
  assert.equal(rehydrated.secretHash, entity.secretHash);
  assert.equal(rehydrated.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(rehydrated.matchesSecretHash(plaintextSecret), true);
});
