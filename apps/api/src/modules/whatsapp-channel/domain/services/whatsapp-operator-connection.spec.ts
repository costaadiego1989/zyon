import test from "node:test";
import assert from "node:assert/strict";
import type { WhatsAppChannelConfigEntity } from "../ports/whatsapp-config-repository.port.js";
import { twilioAuthorityAccountId } from "./connected-twilio-credentials.js";
import { operatorConnection, operatorCredentialDigest } from "./whatsapp-operator-connection.js";
const config = (provider: string): WhatsAppChannelConfigEntity => ({ id: "config", merchantId: "merchant", provider, enabled: true, status: "ACTIVE",
  credentials: provider === "META_CLOUD" ? { accessToken: "synthetic-token", wabaId: "100001", phoneNumberId: "100002" }
    : { accountSid: "ACsynthetic", authToken: "synthetic-token", senderId: "whatsapp:+5511999999999" },
  whatsappNumber: "+5511999999999", createdAt: new Date(0), updatedAt: new Date(0) });
const original = (provider: string, accountId: string) => ({ merchantId: "merchant", configId: "config", deviceId: provider + ":config", provider,
  accountId, recipient: "+12125551234" });
test("operator Meta scope uses the exact canonical account and preserves an explicit international recipient", () => {
  const connection = operatorConnection(config("META_CLOUD"), original("META_CLOUD", "100002")); assert.equal(connection.kind, "ready");
  if (connection.kind !== "ready") throw new Error("canonical_connection_required");
  assert.equal(connection.scope.accountId, "100002"); assert.equal(connection.scope.recipient, "+12125551234");
  assert.equal(connection.scope.credentialDigest, operatorCredentialDigest(config("META_CLOUD")));
  assert.equal(Object.isFrozen(connection.scope), true);
});
test("operator Twilio retains the original credential-bound account identity", () => {
  const value = config("TWILIO"), accountId = twilioAuthorityAccountId(value); assert.ok(accountId);
  const connection = operatorConnection(value, original("TWILIO", accountId)); assert.equal(connection.kind, "ready");
  assert.deepEqual(operatorConnection({ ...value, credentials: { ...value.credentials, authToken: "rotated" } }, original("TWILIO", accountId)),
    { kind: "unavailable", code: "channel_context_changed" });
});
test("offline unavailable and foreign connections never manufacture identity", () => {
  const value = config("META_CLOUD"), authority = original("META_CLOUD", "100002");
  assert.deepEqual(operatorConnection({ ...value, enabled: false }, authority), { kind: "unavailable", code: "channel_offline" });
  assert.deepEqual(operatorConnection({ ...value, credentials: {} }, authority), { kind: "unavailable", code: "channel_identity_unavailable" });
  assert.deepEqual(operatorConnection({ ...value, merchantId: "foreign" }, authority), { kind: "unavailable", code: "channel_context_changed" });
  assert.deepEqual(operatorConnection({ ...value, deviceId: "other-device" }, authority), { kind: "unavailable", code: "channel_context_changed" });
});
test("Bubble device IDs alone cannot prove a global outbound account", () => {
  const value = { ...config("BUBBLEWHATS"), deviceId: "legacy-device", credentials: {} };
  for (const deviceId of ["legacy-device", "forged-device"])
    assert.deepEqual(operatorConnection(value, { ...original("BUBBLEWHATS", deviceId), deviceId }),
      { kind: "unavailable", code: deviceId === "legacy-device" ? "channel_identity_unavailable" : "channel_context_changed" });
});
test("credential digest reflects the actual network credentials without exposing them", () => {
  const value = config("META_CLOUD"), digest = operatorCredentialDigest(value); assert.match(digest!, /^[a-f0-9]{64}$/);
  assert.notEqual(operatorCredentialDigest({ ...value, credentials: { ...value.credentials, accessToken: "rotated" } }), digest);
  assert.equal(JSON.stringify(digest).includes("synthetic-token"), false);
});
