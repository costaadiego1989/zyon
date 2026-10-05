import assert from "node:assert/strict";
import { test } from "node:test";
import { canSyncContactChoice, consentStorageKey, parseStorefrontConsent, STOREFRONT_CONSENT_VERSION } from "./storefront-consent.js";

const choice = { version: STOREFRONT_CONSENT_VERSION, optionalCookies: false, channels: ["email"], decidedAt: new Date().toISOString(), buyerId: null, pendingContactSync: true };
test("missing, corrupt or old browser records never imply consent", () => {
  for (const raw of [null, "bad-json", "{}", JSON.stringify({ ...choice, version: "old" }), JSON.stringify({ ...choice, optionalCookies: "true" }), JSON.stringify({ ...choice, channels: ["sms"] }), JSON.stringify({ ...choice, decidedAt: "bad-date" })]) {
    assert.equal(parseStorefrontConsent(raw), null);
  }
  assert.equal(parseStorefrontConsent(JSON.stringify(choice))?.optionalCookies, false);
  assert.notEqual(consentStorageKey("store-1"), consentStorageKey("store-2"));
});
test("guest permissions can bind once and never transfer to a second account", () => {
  const guest = parseStorefrontConsent(JSON.stringify(choice))!;
  assert.equal(canSyncContactChoice(guest, "buyer-1"), true);
  const bound = { ...guest, buyerId: "buyer-1" };
  assert.equal(canSyncContactChoice(bound, "buyer-1"), true);
  assert.equal(canSyncContactChoice(bound, "buyer-2"), false);
  assert.equal(canSyncContactChoice({ ...bound, pendingContactSync: false }, "buyer-1"), false);
});
