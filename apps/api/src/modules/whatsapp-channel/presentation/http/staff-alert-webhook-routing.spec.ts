import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller.js";

async function request(correlation: string, support: boolean, staff: boolean, valid = true) {
  const previous = process.env.META_APP_SECRET; process.env.META_APP_SECRET = "synthetic-routing-secret";
  const calls: string[] = [], config = { id: "config-a", merchantId: "merchant-a", provider: "META_CLOUD", credentials: { phoneNumberId: "90001001" } };
  const payload = { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "90001001" }, statuses: [
    { id: "synthetic-provider-message", status: "sent", recipient_id: "5511999991111", timestamp: "1900000000", biz_opaque_callback_data: correlation },
  ] } }] }] };
  const rawBody = Buffer.from(JSON.stringify(payload)), signature = "sha256=" + createHmac("sha256", process.env.META_APP_SECRET).update(rawBody).digest("hex");
  const controller = new WhatsAppWebhookController({ findByMetaPhoneNumberId: async () => { calls.push("config"); return config; } } as never, {} as never,
    { reconcileMeta: async () => { calls.push("generic"); } } as never, { receiveMetaReceipt: async () => { calls.push("status"); } } as never,
    support ? { reconcileMeta: async () => { calls.push("operator"); } } as never : undefined,
    staff ? { reconcileMeta: async () => { calls.push("staff"); } } as never : undefined);
  try { return { value: await controller.receiveMetaWebhook(valid ? signature : "sha256=" + "0".repeat(64), payload, { rawBody } as never), calls }; }
  catch (error) { return { error, calls }; }
  finally { if (previous === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = previous; }
}
test("F100-2 signed operator receipt still refuses a missing operator handler even when staff handler exists", async () => {
  const result = await request("support_message:opaque", false, true);
  assert.equal((result.error as Error)?.message, "whatsapp_support_receipts_not_configured"); assert.deepEqual(result.calls, ["config", "generic"]);
});
test("F100-2 signed operator receipt is acknowledged with operator handler present and staff handler absent", async () => {
  const result = await request("support_message:opaque", true, false);
  assert.deepEqual(result.value, { received: true }); assert.equal(result.error, undefined); assert.deepEqual(result.calls, ["config", "generic", "operator", "status"]);
});
test("F100-2 signed staff receipt refuses only its own missing handler", async () => {
  const result = await request("support_case_alert:" + "a".repeat(64), true, false);
  assert.equal((result.error as Error)?.message, "whatsapp_staff_alert_receipts_not_configured"); assert.deepEqual(result.calls, ["config", "generic", "operator"]);
});
test("F100-2 both optional handlers remain independent on the same authenticated Meta route", async () => {
  const result = await request("support_case_alert:" + "a".repeat(64), true, true);
  assert.deepEqual(result.value, { received: true }); assert.equal(result.error, undefined); assert.deepEqual(result.calls, ["config", "generic", "operator", "staff", "status"]);
});
test("F100-2 staff receipt does not require the operator handler for a different purpose", async () => {
  const result = await request("support_case_alert:" + "a".repeat(64), false, true);
  assert.deepEqual(result.value, { received: true }); assert.equal(result.error, undefined); assert.deepEqual(result.calls, ["config", "generic", "staff", "status"]);
});
test("F100-2 invalid Meta signature reaches neither optional handler nor storage", async () => {
  const result = await request("support_message:opaque", true, true, false);
  assert.equal((result.error as Error)?.message, "invalid_meta_signature"); assert.deepEqual(result.calls, []);
});
