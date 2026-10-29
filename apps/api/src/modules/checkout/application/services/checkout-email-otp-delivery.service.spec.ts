import assert from "node:assert/strict";
import test from "node:test";
import type { SendEmailInput, SendEmailOutput } from "../../../notifications/domain/ports/email-sender.port.js";
import type { CheckoutEmailOtpDeliveryPort } from "../../domain/ports/checkout-email-otp-delivery.port.js";
import { CheckoutEmailOtpDeliveryService } from "./checkout-email-otp-delivery.service.js";

const scope = { merchantId: "synthetic-merchant", sessionId: "synthetic-checkout" };
const deliveryId = "9ba59f85-e670-4072-928d-79223466899e", claimToken = "57f5dbaf-d12d-4c2b-9c51-1afbe3b249e2";
const at = Date.parse("2026-10-20T12:00:00Z");
function fixture(sendTimeoutMilliseconds = 15_000) {
  const calls: string[] = [], emails: SendEmailInput[] = [], finishes: unknown[] = [];
  const fault = { request: false, claim: false, complete: false, provider: false, malformedClaim: false, malformedCompletion: false };
  let state: "pending" | "sending" | "sent" | "unknown" | "cancelled" = "pending";
  let reply: SendEmailOutput = { status: "sent", messageId: "synthetic-provider-id" };
  let blockSend: Promise<void> | undefined;
  let clock = at;
  const port: CheckoutEmailOtpDeliveryPort = {
    async requestEmailOtp(receivedScope, request) {
      calls.push("request-committed"); assert.deepEqual(receivedScope, scope);
      assert.ok(["issue", "resend"].includes(request.action));
      if (fault.request) throw new Error("synthetic_request_commit_unknown");
      return { version: 1, ...scope, deliveryId, persistenceVersion: 6, status: "pending" };
    },
    async claimEmailOtpDelivery(receivedScope, request) {
      calls.push("claim-committed"); assert.deepEqual(receivedScope, scope); assert.equal(request.deliveryId, deliveryId);
      if (fault.claim) throw new Error("synthetic_claim_commit_unknown");
      if (state !== "pending") return { kind: "settled", version: 1, ...scope, deliveryId, persistenceVersion: 6,
        status: state === "sending" ? "unknown" : state };
      state = "sending";
      return { kind: "claimed", version: 1, ...scope, deliveryId, persistenceVersion: 6, claimToken,
        email: fault.malformedClaim ? "not-an-email" : "buyer@example.test", code: "123456",
        expiresAt: new Date(at + 600_000).toISOString(), merchantName: "Synthetic <Store>" };
    },
    async completeEmailOtpDelivery(receivedScope, request) {
      calls.push("complete"); assert.deepEqual(receivedScope, scope); assert.equal(request.claimToken, claimToken);
      finishes.push(structuredClone(request));
      if (fault.complete) throw new Error("synthetic_completion_unknown_with_private_data");
      state = request.outcome.status;
      return { version: 1, ...scope, deliveryId, persistenceVersion: fault.malformedCompletion ? 0 : 6, status: state };
    },
  };
  const service = new CheckoutEmailOtpDeliveryService(port, { async send(input) {
    calls.push("provider-send"); assert.equal(state, "sending"); emails.push(structuredClone(input));
    await blockSend;
    if (fault.provider) throw new Error("synthetic_secret_provider_error");
    return reply;
  } }, () => clock, sendTimeoutMilliseconds);
  return { service, calls, emails, finishes, fault, setReply(value: SendEmailOutput) { reply = value; },
    setState(value: typeof state) { state = value; }, setSendWait(value: Promise<void>) { blockSend = value; }, setNow(value: number) { clock = value; } };
}

for (const action of ["issue", "resend"] as const) test(`${action} sends only after committed issuance and claim`, async () => {
  const f = fixture(), result = await f.service.request(scope, { expectedVersion: 5, action });
  assert.deepEqual(result, { version: 1, ...scope, deliveryId, persistenceVersion: 6, status: "sent" });
  assert.deepEqual(f.calls, ["request-committed", "claim-committed", "provider-send", "complete"]);
  assert.equal(f.emails.length, 1); assert.equal(f.emails[0]!.requireDelivery, true);
  assert.equal(f.emails[0]!.idempotencyKey, `checkout-email-otp:${scope.merchantId}:${deliveryId}`);
  assert.equal(f.emails[0]!.to, "buyer@example.test"); assert.equal(f.emails[0]!.merchantId, scope.merchantId);
  assert.match(f.emails[0]!.html, /123456/); assert.match(f.emails[0]!.html, /Synthetic &lt;Store&gt;/);
  assert.deepEqual(f.finishes, [{ deliveryId, claimToken, outcome: { status: "sent", providerMessageId: "synthetic-provider-id" } }]);
  for (const value of ["123456", "buyer@example.test", claimToken, "synthetic-provider-id"]) assert.ok(!JSON.stringify(result).includes(value));
});

for (const state of ["sent", "sending", "unknown", "cancelled"] as const) test(`${state} does not dispatch or complete again`, async () => {
  const f = fixture(); f.setState(state);
  const result = await f.service.deliver(scope, { expectedVersion: 6, deliveryId });
  assert.equal(result.status, state === "sending" ? "unknown" : state); assert.equal(f.emails.length, 0);
  assert.deepEqual(f.calls, ["claim-committed"]);
});

for (const status of ["queued", "skipped"] as const) test(`${status} is not delivery proof and cannot replay`, async () => {
  const f = fixture(); f.setReply({ status, messageId: "synthetic-non-delivery" });
  assert.equal((await f.service.deliver(scope, { expectedVersion: 6, deliveryId })).status, "unknown");
  assert.equal((await f.service.deliver(scope, { expectedVersion: 6, deliveryId })).status, "unknown");
  assert.equal(f.emails.length, 1); assert.deepEqual(f.finishes, [{ deliveryId, claimToken, outcome: { status: "unknown" } }]);
});
test("empty sent provider ID remains unknown with no retry", async () => {
  const f = fixture(); f.setReply({ status: "sent", messageId: " " });
  assert.equal((await f.service.deliver(scope, { expectedVersion: 6, deliveryId })).status, "unknown"); assert.equal(f.emails.length, 1);
});
test("provider exception is sanitized unknown, never retried", async () => {
  const f = fixture(); f.fault.provider = true;
  const result = await f.service.deliver(scope, { expectedVersion: 6, deliveryId });
  assert.equal(result.status, "unknown"); assert.ok(!JSON.stringify(result).includes("secret")); assert.equal(f.emails.length, 1);
  await f.service.deliver(scope, { expectedVersion: 6, deliveryId }); assert.equal(f.emails.length, 1);
});
test("lost completion ACK after accepted send remains unknown and does not send again", async () => {
  const f = fixture(); f.fault.complete = true;
  const result = await f.service.deliver(scope, { expectedVersion: 6, deliveryId }); assert.equal(result.status, "unknown");
  f.fault.complete = false; await f.service.deliver(scope, { expectedVersion: 6, deliveryId }); assert.equal(f.emails.length, 1);
  assert.equal(f.finishes.length, 1); assert.ok(!JSON.stringify(result).includes("private"));
});
test("concurrent deliver calls cannot send twice after persistent claim", async () => {
  const f = fixture(); let release!: () => void; f.setSendWait(new Promise(resolve => { release = resolve; }));
  const first = f.service.deliver(scope, { expectedVersion: 6, deliveryId });
  const second = await f.service.deliver(scope, { expectedVersion: 6, deliveryId }); assert.equal(second.status, "unknown");
  release(); assert.equal((await first).status, "sent"); assert.equal(f.emails.length, 1);
});
for (const fault of ["request", "claim", "malformedClaim"] as const) test(`${fault} failure never sends`, async () => {
  const f = fixture(); f.fault[fault] = true;
  await assert.rejects(f.service.request(scope, { expectedVersion: 5, action: "issue" })); assert.equal(f.emails.length, 0);
});
test("invalid completion response cannot claim success or cause a second send", async () => {
  const f = fixture(); f.fault.malformedCompletion = true;
  assert.equal((await f.service.deliver(scope, { expectedVersion: 6, deliveryId })).status, "unknown"); assert.equal(f.emails.length, 1);
});
test("provider timeout is unknown and late acceptance does not replay or complete twice", async () => {
  const f = fixture(5); let release!: () => void; f.setSendWait(new Promise(resolve => { release = resolve; }));
  const result = await f.service.deliver(scope, { expectedVersion: 6, deliveryId }); assert.equal(result.status, "unknown");
  release(); await Promise.resolve(); assert.equal(f.finishes.length, 1);
  await f.service.deliver(scope, { expectedVersion: 6, deliveryId }); assert.equal(f.emails.length, 1);
});
for (const now of [at + 600_000, Number.NaN]) test(`expired or invalid local dispatch clock never sends (${String(now)})`, async () => {
  const f = fixture(); f.setNow(now);
  assert.equal((await f.service.deliver(scope, { expectedVersion: 6, deliveryId })).status, "unknown");
  assert.equal(f.emails.length, 0); assert.deepEqual(f.finishes, [{ deliveryId, claimToken, outcome: { status: "unknown" } }]);
});
for (const patch of [{ email: "attacker@example.test" }, { code: "777777" }, { expiresAt: "2099-01-01T00:00:00Z" },
  { cart: {} }, { claimToken }, { action: "automatic_retry" }, { expectedVersion: 0 }])
  test(`strict issuance refuses caller authority ${Object.keys(patch).join()}`, async () => {
    const f = fixture(); await assert.rejects(f.service.request(scope, { expectedVersion: 5, action: "issue", ...patch }));
    assert.deepEqual(f.calls, []);
  });
