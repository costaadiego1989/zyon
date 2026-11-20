import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { AcceptBubbleWhatsWebhookUseCase } from "./accept-bubblewhats-webhook.use-case.js";
import { isEquivalentLegacyAuthenticatedReplay } from "../../infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.js";
import type { WhatsAppInboxEvent } from "../../domain/ports/whatsapp-webhook-inbox.port.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const message = { fromNumber: "+5511999991111", body: "Synthetic request", messageType: "text", timestamp: 1900000000000 };
const meta = { id: "config-a", merchantId: "merchant-a", provider: "META_CLOUD", enabled: true, credentials: { phoneNumberId: "90001001", accessToken: "synthetic-token" } };
function fixture() {
  const events: WhatsAppInboxEvent[] = [];
  const accept = new AcceptBubbleWhatsWebhookUseCase({} as never, { accept: async (batch: WhatsAppInboxEvent[]) => { events.push(...batch); } } as never);
  return { accept, events };
}
test("F100-1 immutable inbox account comes from a separate authenticated server argument, never message fields", async () => {
  const f = fixture(), input = { ...message, authenticatedAccount: { provider: "META_CLOUD", accountId: "forged" } };
  await f.accept.messageForAuthenticatedConfig(meta as never, "META", "event-a", input, { provider: "META_CLOUD", accountId: "90001001" });
  const event = f.events[0], payload = event.payload as unknown as Record<string, unknown>;
  assert.deepEqual(payload.authenticatedAccount, { provider: "META_CLOUD", accountId: "90001001" });
  assert.equal(event.payloadHash, digest(payload)); assert.doesNotMatch(JSON.stringify(payload), /synthetic-token|forged/);
});
test("F100-1 missing or mismatched internal account evidence cannot create a recipient window fact", async () => {
  const f = fixture();
  await f.accept.messageForAuthenticatedConfig(meta as never, "META", "event-missing", message);
  await f.accept.messageForAuthenticatedConfig(meta as never, "META", "event-wrong", message, { provider: "META_CLOUD", accountId: "90001002" });
  for (const event of f.events) { assert.equal(Object.hasOwn(event.payload, "authenticatedAccount"), false); assert.equal(event.payloadHash, digest(event.payload)); }
});
test("F100-1 token-only rotation on the same authenticated account does not rewrite historical window identity", async () => {
  const f = fixture(), proof = { provider: "META_CLOUD" as const, accountId: "90001001" };
  await f.accept.messageForAuthenticatedConfig(meta as never, "META", "event-before", message, proof);
  await f.accept.messageForAuthenticatedConfig({ ...meta, credentials: { ...meta.credentials, accessToken: "synthetic-rotated" } } as never, "META", "event-after", message, proof);
  assert.deepEqual(f.events[0].payload, f.events[1].payload); assert.equal(f.events[0].payloadHash, f.events[1].payloadHash);
});
test("F100-1 Twilio account and signed To are retained independently from a rotatable token", async () => {
  const f = fixture(), accountId = "AC" + "a".repeat(32), sender = "+5511999992222", config = { ...meta, provider: "TWILIO", whatsappNumber: sender, credentials: { accountSid: accountId, authToken: "synthetic-token", senderId: "whatsapp:" + sender } };
  await f.accept.messageForAuthenticatedConfig(config as never, "TWILIO", "event-before", message, { provider: "TWILIO", accountId, sender });
  await f.accept.messageForAuthenticatedConfig({ ...config, credentials: { ...config.credentials, authToken: "synthetic-new-token" } } as never, "TWILIO", "event-after", message, { provider: "TWILIO", accountId, sender });
  assert.deepEqual((f.events[0].payload as unknown as Record<string, unknown>).authenticatedAccount, { provider: "TWILIO", accountId, sender });
  assert.deepEqual(f.events[0].payload, f.events[1].payload);
  await f.accept.messageForAuthenticatedConfig(config as never, "TWILIO", "event-wrong", message, { provider: "TWILIO", accountId, sender: "+5511999993333" });
  assert.equal(Object.hasOwn(f.events[2].payload, "authenticatedAccount"), false);
});
test("F100-1 a legacy Meta replay preserves old payload/hash and never upgrades missing proof", () => {
  const previous = { merchantId: "merchant-a", deviceId: "META_CLOUD:config-a", provider: "META_CLOUD", ...message }, frozen = structuredClone(previous), hash = digest(previous);
  const candidate = { ...previous, authenticatedAccount: { provider: "META_CLOUD", accountId: "90001001" } };
  assert.equal(isEquivalentLegacyAuthenticatedReplay(previous, hash, candidate), true); assert.deepEqual(previous, frozen);
  assert.equal(isEquivalentLegacyAuthenticatedReplay(previous, "wrong-hash", candidate), false);
  for (const patch of [{ body: "changed" }, { merchantId: "merchant-b" }, { deviceId: "META_CLOUD:foreign" }, { extra: "unrecognized" }])
    assert.equal(isEquivalentLegacyAuthenticatedReplay(previous, hash, { ...candidate, ...patch }), false);
  assert.equal(isEquivalentLegacyAuthenticatedReplay({ ...previous, authenticatedAccount: { provider: "META_CLOUD", accountId: "90001002" } }, hash, candidate), false);
});
test("F100-1 legacy Twilio replay retains only the existing local timestamp exception and all field conflicts", () => {
  const previous = { merchantId: "merchant-a", deviceId: "TWILIO:config-a", provider: "TWILIO", ...message };
  const candidate = { ...previous, timestamp: message.timestamp + 1000, authenticatedAccount: { provider: "TWILIO", accountId: "AC" + "a".repeat(32), sender: "+5511999992222" } };
  assert.equal(isEquivalentLegacyAuthenticatedReplay(previous, digest(previous), candidate), true);
  assert.equal(isEquivalentLegacyAuthenticatedReplay(previous, "wrong-hash", candidate), false);
  assert.equal(isEquivalentLegacyAuthenticatedReplay(previous, digest(previous), { ...candidate, body: "changed" }), false);
  assert.equal(isEquivalentLegacyAuthenticatedReplay(previous, digest(previous), { ...candidate, extra: "changed" }), false);
  assert.equal(isEquivalentLegacyAuthenticatedReplay(candidate, digest(candidate), { ...candidate, authenticatedAccount: { ...candidate.authenticatedAccount, accountId: "AC" + "b".repeat(32) } }), false);
});
