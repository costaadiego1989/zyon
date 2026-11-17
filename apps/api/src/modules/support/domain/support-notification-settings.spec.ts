import assert from "node:assert/strict";
import test from "node:test";
import { parseSupportNotificationRecipient } from "./support-notification-settings.js";

test("HUM-09 private recipient input", async t => {
  await t.test("accepts explicit clear without inventing another destination", () => {
    assert.equal(parseSupportNotificationRecipient({ fallbackPhone: null }), null);
  });
  await t.test("normalizes the configured Brazilian recipient", () => {
    assert.equal(parseSupportNotificationRecipient({ fallbackPhone: "(21) 99999-0101" }), "+5521999990101");
    assert.equal(parseSupportNotificationRecipient({ fallbackPhone: "+55 21 99999-0101" }), "+5521999990101");
  });
  await t.test("preserves an explicitly international recipient", () => {
    assert.equal(parseSupportNotificationRecipient({ fallbackPhone: "+1 212 555 0183" }), "+12125550183");
  });
  await t.test("rejects omitted, malformed or foreign configuration without echoing the value", () => {
    for (const value of [null, [], {}, { fallbackPhone: undefined }, { fallbackPhone: 21999990101 },
      { fallbackPhone: "" }, { fallbackPhone: "private@example.test" }, { fallbackPhone: "+00000000" },
      { fallbackPhone: "+1234567890123456" }, { fallbackPhone: "1".repeat(41) },
      { fallbackPhone: "+12125550183", merchantId: "foreign" }, { fallbackPhone: null, faqItems: [] }]) {
      assert.throws(() => parseSupportNotificationRecipient(value), error => {
        assert.equal((error as { getStatus(): number }).getStatus(), 400);
        assert.equal((error as Error).message, "support_notification_settings_invalid");
        return true;
      });
    }
  });
});
