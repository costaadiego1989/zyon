import assert from "node:assert/strict";
import test from "node:test";
import { isEquivalentTwilioReplay } from "./prisma-whatsapp-webhook-inbox.repository.js";

test("T50 Twilio fingerprint", async t => {
  const payload = { merchantId: "synthetic-merchant", deviceId: "synthetic-device", provider: "TWILIO", fromNumber: "+5511999999999",
    fromAlias: "Synthetic Buyer", body: "Mensagem para a equipe", messageType: "text", mediaUrl: "https://example.invalid/audio.ogg", mimetype: "audio/ogg", timestamp: 1000 };
  await t.test("only the local ingest timestamp may differ and JSONB field order does not create another message", () => {
    const reversed = Object.fromEntries(Object.entries({ ...payload, timestamp: 1001 }).reverse());
    const previous = Object.freeze({ ...payload });
    assert.equal(isEquivalentTwilioReplay(previous, reversed), true);
    assert.deepEqual(previous, payload);
  });
  await t.test("every provider message field, identity and future payload field remains part of the conflict check", () => {
    for (const [key, value] of Object.entries(payload).filter(([key]) => key !== "timestamp"))
      assert.equal(isEquivalentTwilioReplay(payload, { ...payload, [key]: String(value) + "-changed", timestamp: 2000 }), false, key);
    assert.equal(isEquivalentTwilioReplay(payload, { ...payload, added: "new-provider-data", timestamp: 2000 }), false);
    assert.equal(isEquivalentTwilioReplay({ ...payload, extra: { timestamp: 1 } }, { ...payload, extra: { timestamp: 2 }, timestamp: 2000 }), false);
  });
  await t.test("Meta and BubbleWhats provider timestamps are never normalized by this exception", () => {
    for (const provider of ["META_CLOUD", "BUBBLEWHATS"])
      assert.equal(isEquivalentTwilioReplay({ ...payload, provider }, { ...payload, provider, timestamp: 2000 }), false);
    assert.equal(isEquivalentTwilioReplay(payload, { ...payload, provider: "META_CLOUD", timestamp: 2000 }), false);
  });
  await t.test("malformed or non-message payloads cannot enter the Twilio exception", () => {
    for (const previous of [null, [], "TWILIO", { provider: "TWILIO" }, { ...payload, body: undefined }, { ...payload, timestamp: "1000" }, { ...payload, timestamp: -1 }])
      assert.equal(isEquivalentTwilioReplay(previous, payload), false);
    assert.equal(isEquivalentTwilioReplay(payload, { provider: "TWILIO", messages: [] }), false);
  });
});
