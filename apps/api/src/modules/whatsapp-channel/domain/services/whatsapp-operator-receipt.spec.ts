import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { mergeOperatorDelivery } from "./whatsapp-operator-delivery.js";
import { twilioAuthorityAccountId } from "./connected-twilio-credentials.js";
import { parseMetaOperatorReceipt, parseTwilioOperatorReceipt, readTwilioReceiptForm,
  readOriginalOperatorAttempt, operatorReceiptAccountMatches } from "./whatsapp-operator-receipt.js";
import type { WhatsAppChannelConfigEntity } from "../ports/whatsapp-config-repository.port.js";

const sid = "AC" + "1".repeat(32), messageSid = "SM" + "2".repeat(32);
const config: WhatsAppChannelConfigEntity = { id: "config", merchantId: "merchant", provider: "TWILIO", enabled: true, status: "ACTIVE",
  whatsappNumber: "+5511999880001", credentials: { accountSid: sid, authToken: "synthetic-original", senderId: "whatsapp:+5511999880001" },
  createdAt: new Date(0), updatedAt: new Date(0) };
const credentialDigest = createHash("sha256").update(canonicalJson({ provider: "TWILIO", accountSid: sid,
  authToken: config.credentials.authToken, senderId: config.credentials.senderId, whatsappNumber: config.whatsappNumber })).digest("hex");
const submission = { attemptToken: "original-attempt", outboxEventId: "original-event", outboxLeaseToken: "original-lease",
  credentialDigest, phase: "unknown", requestInvoked: true, commitUnknown: true };
const attempt = readOriginalOperatorAttempt({ outboxEventId: "original-event", submission }, "original-attempt")!;
const original = { provider: "TWILIO", accountId: twilioAuthorityAccountId(config)!, recipient: "+5511999990001" };
const receipt = { provider: "TWILIO" as const, providerAccountId: sid, providerMessageId: messageSid, status: "read" as const,
  recipient: original.recipient, sender: "+5511999880001" };

test("HUM05 Meta maps provider acceptance separately from read and never invents an absent recipient", () => {
  assert.deepEqual(parseMetaOperatorReceipt("phone-account", { id: "provider-message", status: "sent", biz_opaque_callback_data: "support_message:message" }),
    { provider: "META_CLOUD", providerAccountId: "phone-account", providerMessageId: "provider-message", status: "accepted", correlationId: "support_message:message" });
  assert.equal(parseMetaOperatorReceipt("phone-account", { id: "provider-message", status: "read" })?.status, "read");
  assert.equal(parseMetaOperatorReceipt("phone-account", { id: "provider-message", status: "read", recipient_id: { forged: true } }), undefined);
  assert.equal(parseMetaOperatorReceipt("phone-account", { id: "provider-message", status: "read", biz_opaque_callback_data: "order_notification:other" }), undefined);
});

test("HUM05 Twilio admits only outbound WhatsApp receipts with exact IDs and retains unknown signed scalar parameters", () => {
  const form = { AccountSid: sid, MessageSid: messageSid, MessageStatus: "read", ChannelPrefix: "whatsapp", FutureProviderField: "signed+value" };
  assert.deepEqual(readTwilioReceiptForm(form), form);
  assert.deepEqual(parseTwilioOperatorReceipt(form), { provider: "TWILIO", providerAccountId: sid, providerMessageId: messageSid, status: "read" });
  for (const patch of [{ MessageStatus: "received" }, { ChannelPrefix: "sms" }, { MessageSid: "wrong" }, { AccountSid: "wrong" }, { To: "sms:+5511999990001" }])
    assert.equal(parseTwilioOperatorReceipt({ ...form, ...patch }), undefined);
  for (const value of [null, [], { ...form, MessageSid: [messageSid, messageSid] }, { ...form, Nested: {} }, { ...form, Unknown: 1 }])
    assert.equal(readTwilioReceiptForm(value), undefined);
});

test("HUM05 original attempt proof cannot adopt a replacement token/event/lease or upgrade a durable no-start", () => {
  assert.equal(attempt.outboxLeaseToken, "original-lease");
  assert.equal(Object.isFrozen(attempt), true);
  assert.equal(readOriginalOperatorAttempt({ outboxEventId: "other-event", submission }, "original-attempt"), undefined);
  assert.equal(readOriginalOperatorAttempt({ outboxEventId: "original-event", submission }, "replacement-attempt"), undefined);
  for (const patch of [{ requestInvoked: false }, { requestInvoked: undefined }, { outboxLeaseToken: "" }, { credentialDigest: "" }, { phase: "not_started" }])
    assert.equal(readOriginalOperatorAttempt({ outboxEventId: "original-event", submission: { ...submission, ...patch } }, "original-attempt"), undefined);
});

test("HUM05 exact historical Twilio identity survives disabled state, but missing original SID or wrong sender/recipient cannot be adopted", () => {
  assert.equal(operatorReceiptAccountMatches(original, attempt, { ...config, enabled: false, status: "INACTIVE" }, receipt), true);
  assert.equal(operatorReceiptAccountMatches({ ...original, accountId: "twilio:number:+5511999880001:" + "a".repeat(64) }, attempt, config, receipt), false);
  for (const patch of [{ providerAccountId: "AC" + "3".repeat(32) }, { sender: "+5511999880002" }, { recipient: "+5511999990002" }])
    assert.equal(operatorReceiptAccountMatches(original, attempt, config, { ...receipt, ...patch }), false);
  assert.equal(operatorReceiptAccountMatches({ ...original, provider: "BUBBLEWHATS" }, attempt, config, receipt), false);
});

test("HUM05 rotation needs a persisted original sender; the new account cannot replace the original", () => {
  const rotated = { ...config, credentials: { ...config.credentials, authToken: "synthetic-rotated" } };
  assert.equal(operatorReceiptAccountMatches(original, attempt, rotated, receipt), false);
  const proven = { ...attempt, providerAccountId: sid, sender: "+5511999880001" };
  assert.equal(operatorReceiptAccountMatches(original, proven, rotated, receipt), true);
  assert.equal(operatorReceiptAccountMatches(original, { ...proven, providerAccountId: "AC" + "3".repeat(32) }, rotated, receipt), false);
});

test("HUM05 read precedes delivered and duplicates do not change revision; a conflicting provider ID never replaces the original", () => {
  const read = mergeOperatorDelivery({ status: "unknown", revision: 1, providerMessageId: null, errorCode: "submission_unknown" }, { status: "read", providerMessageId: "provider-message" });
  assert.deepEqual(read, { changed: true, state: { status: "read", revision: 2, providerMessageId: "provider-message" } });
  for (const status of ["read", "delivered", "accepted", "failed"] as const)
    assert.deepEqual(mergeOperatorDelivery(read.state, { status, providerMessageId: "provider-message", ...(status === "failed" ? { errorCode: "provider_delivery_failed" } : {}) }), { changed: false, state: read.state });
  assert.throws(() => mergeOperatorDelivery(read.state, { status: "read", providerMessageId: "other-provider-message" }), /operator_delivery_provider_conflict/);
});
