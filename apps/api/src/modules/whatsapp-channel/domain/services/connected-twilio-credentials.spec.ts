import assert from "node:assert/strict";
import test from "node:test";
import { connectedTwilioCredentials, twilioAuthorityAccountId } from "./connected-twilio-credentials.js";

const base = { id: "config", merchantId: "merchant", provider: "TWILIO", enabled: true, status: "ACTIVE",
  whatsappNumber: "+5511988880001", credentials: { authToken: "synthetic-local-token" }, createdAt: new Date(0), updatedAt: new Date(0) };
test("T51 Twilio connection identity", async t => {
  await t.test("authenticated legacy intake has a number identity without granting SDK eligibility", () => {
    const identity = twilioAuthorityAccountId(base);
    assert.match(identity!, /^twilio:number:\+5511988880001:[a-f0-9]{64}$/);
    assert.equal(identity!.includes(base.credentials.authToken), false);
    assert.equal(connectedTwilioCredentials(base, base.merchantId), null);
  });
  await t.test("a canonical account SID is discriminated from a legacy number and preserves outbound checks", () => {
    const config = { ...base, credentials: { ...base.credentials, accountSid: "AC" + "a".repeat(32), senderId: "whatsapp:" + base.whatsappNumber } };
    assert.match(twilioAuthorityAccountId(config)!, /^twilio:account:AC[a-f0-9]{32}:[a-f0-9]{64}$/);
    assert.notEqual(twilioAuthorityAccountId(base), twilioAuthorityAccountId(config));
    assert.deepEqual(connectedTwilioCredentials(config, base.merchantId), config.credentials);
    assert.equal(connectedTwilioCredentials({ ...config, credentials: { ...config.credentials, onboardingVersion: 2, senderStatus: "OFFLINE" } }, base.merchantId), null);
  });
  await t.test("canonical ordering and formatting are stable while To, SID and token rotation invalidate old work", () => {
    const config = { ...base, credentials: { accountSid: "AC" + "a".repeat(32), authToken: base.credentials.authToken, senderId: "whatsapp:" + base.whatsappNumber } };
    const identity = twilioAuthorityAccountId(config);
    assert.equal(twilioAuthorityAccountId({ ...config, whatsappNumber: "55 (11) 98888-0001", credentials: {
      senderId: config.credentials.senderId, authToken: config.credentials.authToken, accountSid: config.credentials.accountSid } }), identity);
    for (const changed of [{ ...config, whatsappNumber: "+5511988880002" },
      { ...config, credentials: { ...config.credentials, accountSid: "AC" + "b".repeat(32) } },
      { ...config, credentials: { ...config.credentials, authToken: "rotated-synthetic-token" } },
      { ...config, credentials: { ...config.credentials, senderStatus: "OFFLINE" } }])
      assert.notEqual(twilioAuthorityAccountId(changed), identity);
  });
  await t.test("invalid present SID or non-string provider/token never coerces into a legacy identity", () => {
    for (const sid of [null, "", " ", ["AC"], { toString: () => "AC" }])
      assert.equal(twilioAuthorityAccountId({ ...base, credentials: { ...base.credentials, accountSid: sid } }), null);
    for (const provider of [["TWILIO"], { toString: () => "TWILIO" }])
      assert.equal(Reflect.apply(twilioAuthorityAccountId, undefined, [{ ...base, provider }]), null);
    assert.equal(twilioAuthorityAccountId({ ...base, credentials: { authToken: ["token"] } }), null);
    assert.equal(twilioAuthorityAccountId({ ...base, whatsappNumber: "invalid" }), null);
  });
});
