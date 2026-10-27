import assert from "node:assert/strict";
import test from "node:test";
import { TrackCheckoutEventUseCase } from "../application/use-cases/track-checkout-event.use-case.js";
import { NORMAL_COMMERCIAL_BENEFIT_EVENT } from "../domain/contracts/normal-commercial-benefit-proof.schemas.js";
import { checkoutSession } from "./checkout-test-fixtures.js";

for (const event of [NORMAL_COMMERCIAL_BENEFIT_EVENT, "auth_identity_confirmed", "buyer_identity_detached"]) for (const metadata of [undefined,
  { merchantId: "mrc_1", checkoutSessionId: "chk_1", buyerId: "buyer", discountCents: 1000,
    checkoutVersion: 1, policyFingerprint: "a".repeat(64) }]) test(`public telemetry cannot mint ${event}, even with shaped metadata`, async () => {
  const calls: string[] = [], session = checkoutSession();
  const sessions = { async getSession() { return session; }, async recordEvent() { calls.push("event"); } };
  const outbox = { async appendOutbox() { calls.push("outbox"); } };
  const useCase = new TrackCheckoutEventUseCase(sessions as never, outbox as never);
  await assert.rejects(useCase.execute({ merchant_id: session.merchantId, session_id: session.sessionId,
    event: event as never, metadata }), /checkout_event_server_only/);
  assert.deepEqual(calls, []);
});
