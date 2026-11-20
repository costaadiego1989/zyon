import assert from "node:assert/strict";
import test from "node:test";
import { staffAlertId, staffAlertLink, parseStaffAlertDispatch, ownsStaffAlertDispatch, publicStaffAlert,
  staffWindowOpen, staffTemplateSnapshot, mergeStaffAlert, STAFF_ALERT_REQUESTED } from "./support-case-alert.js";
import { twilioOperatorStatusCallbackUrl } from "../../whatsapp-channel/domain/services/public-url.js";

const now = new Date("2030-01-01T12:00:00Z");
const authority = { merchantId: "merchant-a", configId: "config-a", deviceId: "META_CLOUD:config-a", provider: "META_CLOUD",
  accountId: "12345678", recipient: "+5511999991111" };
test("HUM-10 staff alert identity belongs to one tenant, ticket and creation epoch", () => {
  const first = staffAlertId("merchant-a", "ticket-a", 1);
  assert.match(first, /^support_case_alert:[a-f0-9]{64}$/);
  assert.equal(staffAlertId("merchant-a", "ticket-a", 1), first);
  for (const args of [["merchant-b", "ticket-a", 1], ["merchant-a", "ticket-b", 1], ["merchant-a", "ticket-a", 2]] as const)
    assert.notEqual(staffAlertId(args[0], args[1], args[2]), first);
  assert.throws(() => staffAlertId("merchant-a", "ticket-a", 0));
});
test("HUM-10 private link carries only encoded ticket selection and requires the normal dashboard", () => {
  const link = staffAlertLink("ticket /?#", "https://app.example.test/dashboard");
  assert.equal(link, "https://app.example.test/dashboard#whatsapp-seller?tab=conversations&ticketId=ticket%20%2F%3F%23");
  for (const base of ["http://app.example.test", "https://user:secret@app.example.test", "https://app.example.test?token=private", "javascript:alert(1)"])
    assert.throws(() => staffAlertLink("ticket", base));
  assert.doesNotMatch(link, /bearer|phone|email|customer/i);
});
test("HUM-10 dispatch requires exact durable purpose, identity and live original lease", () => {
  const alertId = staffAlertId("merchant-a", "ticket-a", 1), payload = { alertId, ticketId: "ticket-a", bindingId: "binding-a", creationEpoch: 1 };
  const event = { eventId: "event-a", eventType: STAFF_ALERT_REQUESTED, merchantId: "merchant-a", schemaVersion: 1,
    correlationId: alertId, causationId: "ticket-a", payload, deliveryLeaseToken: "lease-a" };
  const proof = parseStaffAlertDispatch(event); assert.ok(proof);
  const row = { ...event, producer: "support", status: "processing", leaseToken: "lease-a", leaseExpiresAt: new Date(now.getTime() + 1000) };
  assert.equal(ownsStaffAlertDispatch(proof, row, now), true);
  for (const patch of [{ merchantId: "merchant-b" }, { leaseToken: "other" }, { leaseExpiresAt: now }, { producer: "buyer" }, { payload: { ...payload, creationEpoch: 2 } }])
    assert.equal(ownsStaffAlertDispatch(proof, { ...row, ...patch }, now), false);
  for (const patch of [{ eventType: "whatsapp.support.message.requested" }, { correlationId: "support_message:forged" }, { payload: { ...payload, recipient: "+5511222222222" } }])
    assert.equal(parseStaffAlertDispatch({ ...event, ...patch }), undefined);
});
test("HUM-10 window is specific to the configured recipient, authenticated account and final clock", () => {
  const row = { merchantId: authority.merchantId, configId: authority.configId, deviceId: authority.deviceId, kind: "message", createdAt: now,
    payload: { ...authority, authenticatedAccount: { provider: "META_CLOUD", accountId: authority.accountId }, fromNumber: authority.recipient, timestamp: now.getTime(), ignored: false } };
  assert.equal(staffWindowOpen(row, authority, now), true);
  for (const payload of [{ ...row.payload, fromNumber: "+5511999992222" }, { ...row.payload, ignored: true }, { ...row.payload, provider: "TWILIO" }, { ...row.payload, merchantId: "merchant-b" }])
    assert.equal(staffWindowOpen({ ...row, payload }, authority, now), false);
  assert.equal(staffWindowOpen(row, authority, new Date(now.getTime() + 24 * 60 * 60 * 1000)), false);
  assert.equal(staffWindowOpen({ ...row, createdAt: new Date(now.getTime() + 1000) }, authority, now), false);
});
test("F100-1 a prior account or missing provenance cannot authorize a new account on the same config/device", () => {
  const row = { merchantId: authority.merchantId, configId: authority.configId, deviceId: authority.deviceId, kind: "message", createdAt: now,
    payload: { ...authority, authenticatedAccount: { provider: "META_CLOUD", accountId: "90001000" }, fromNumber: authority.recipient, timestamp: now.getTime() } };
  assert.equal(staffWindowOpen(row, { ...authority, accountId: "90001001" }, now), false);
  assert.equal(staffWindowOpen({ ...row, payload: { ...row.payload, authenticatedAccount: undefined } }, authority, now), false);
  assert.equal(staffWindowOpen({ ...row, payload: { ...row.payload, authenticatedAccount: { provider: "META_CLOUD", accountId: authority.accountId } } }, authority, now), true);
  const sid = "AC" + "a".repeat(32), sender = "+5511999992222", twilio = { ...authority, provider: "TWILIO", accountId: "twilio:account:" + sid + ":" + "a".repeat(64), providerAccountId: sid, sender };
  const inbound = { ...row, payload: { ...row.payload, provider: "TWILIO", authenticatedAccount: { provider: "TWILIO", accountId: sid, sender } } };
  assert.equal(staffWindowOpen(inbound, twilio, now), true);
  assert.equal(staffWindowOpen(inbound, { ...twilio, accountId: "twilio:account:" + sid + ":" + "b".repeat(64) }, now), true);
  assert.equal(staffWindowOpen(inbound, { ...twilio, sender: "+5511999993333" }, now), false);
});
test("HUM-10 outside the recipient window only the current same-account approved staff template is eligible", () => {
  const template = { id: "template-a", merchantId: "merchant-a", type: "support_case_alert", channel: "whatsapp", isActive: true,
    metaStatus: "approved", metaWabaId: "waba-a", metaRevision: 3, metaLanguage: "pt_BR", metaCategory: "UTILITY",
    metaLastCheckedAt: now, metaTemplateBody: "Atendimento em {{1}}. Abra {{2}}. Obrigado.", metaVariableMap: { "1": "storeName", "2": "dashboardLink" }, twilioContentSid: "staff_alert" };
  const proof = staffTemplateSnapshot(template, "merchant-a", "waba-a", now); assert.ok(proof); assert.equal(proof.revision, 3);
  for (const patch of [{ merchantId: "merchant-b" }, { type: "order_confirmation" }, { metaWabaId: "other" }, { isActive: false }, { metaStatus: "pending" }, { metaCategory: "MARKETING" },
    { metaVariableMap: { "1": "buyerName", "2": "dashboardLink" } }, { metaLastCheckedAt: new Date(now.getTime() - 15 * 60_000) }])
    assert.equal(staffTemplateSnapshot({ ...template, ...patch }, "merchant-a", "waba-a", now), undefined);
});
test("HUM-07 public alert projection excludes fallback, authority, attempts, template and provider identifiers", () => {
  const projection = publicStaffAlert({ status: "unknown", revision: 2, providerMessageId: "private-provider-id", errorCode: "private-error",
    recipient: "+5511999991111", credentialDigest: "private", template: "private", attemptToken: "private" });
  assert.deepEqual(projection, { status: "unknown", revision: 2 });
  assert.deepEqual(publicStaffAlert({ status: "unavailable", revision: 0 }), { status: "unavailable", revision: 0 });
  assert.equal(publicStaffAlert({ status: "made-up", revision: 0 }), undefined);
});
test("HUM-07 provider acceptance never claims delivery and unknown cannot be downgraded by replay", () => {
  const queued = { status: "queued" as const, revision: 0, providerMessageId: null };
  const accepted = mergeStaffAlert(queued, { status: "accepted", providerMessageId: "provider-a" });
  assert.deepEqual(accepted, { status: "accepted", revision: 1, providerMessageId: "provider-a" });
  assert.deepEqual(mergeStaffAlert(accepted, { status: "queued", providerMessageId: null }), accepted);
  const read = mergeStaffAlert(accepted, { status: "read", providerMessageId: "provider-a" });
  assert.deepEqual(mergeStaffAlert(read, { status: "failed", providerMessageId: "provider-a" }), read);
  assert.throws(() => mergeStaffAlert(accepted, { status: "read", providerMessageId: "other" }));
});
test("HUM-10 Twilio staff correlation uses only the existing authenticated callback URL and exact purpose", () => {
  const env = { API_PUBLIC_URL: "https://api.example.test" }, id = staffAlertId("merchant-a", "ticket-a", 1);
  assert.equal(twilioOperatorStatusCallbackUrl("config/a", id, env), "https://api.example.test/v1/webhooks/whatsapp/twilio/status?configId=config%2Fa&correlationId=" + encodeURIComponent(id));
  assert.equal(twilioOperatorStatusCallbackUrl("config", "support_message:original", env), "https://api.example.test/v1/webhooks/whatsapp/twilio/status?configId=config&correlationId=support_message%3Aoriginal");
  for (const invalid of ["support_case_alert:forged", "support_resume:other", "support_anything:other"])
    assert.equal(twilioOperatorStatusCallbackUrl("config", invalid, env), null);
  assert.equal(twilioOperatorStatusCallbackUrl("config", id, { API_PUBLIC_URL: "https://user:secret@api.example.test" }), null);
});
