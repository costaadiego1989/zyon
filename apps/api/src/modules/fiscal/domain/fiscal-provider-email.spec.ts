import assert from "node:assert/strict";
import test from "node:test";
import { fiscalProviderEmailDecision, restoreFiscalProviderEmailRequest } from "./fiscal-provider-email.js";
import type { FiscalSnapshotEnvelope } from "./fiscal-sale-snapshot.port.js";

const envelope = (email?: string, owner = "provider") => ({ policy: { emailOwner: owner }, buyerContacts: { email }, fiscalRecipient: { email: "recipient@example.test" } }) as unknown as FiscalSnapshotEnvelope;
test("FISCAL-47 provider email uses only the valid original buyer contact and preserves its owner", () => {
  assert.deepEqual(fiscalProviderEmailDecision(envelope(" buyer@example.test ")), { owner: "provider", requested: true });
  assert.deepEqual(fiscalProviderEmailDecision(envelope()), { owner: "provider", requested: false, reasonCode: "fiscal_email_destination_unavailable" });
  assert.deepEqual(fiscalProviderEmailDecision(envelope("invalid")), { owner: "provider", requested: false, reasonCode: "fiscal_email_destination_invalid" });
  assert.deepEqual(fiscalProviderEmailDecision(envelope("buyer@example.test", "zyon")), { owner: "zyon", requested: false });
});
test("FISCAL-47 durable provider request normalization distinguishes payload inclusion from message acceptance", () => {
  const source = envelope("buyer@example.test");
  for (const [provider, metadata] of [["focus", { sendEmail: "true", includedEmail: "true" }], ["tiny", { requested: "true", included: "true" }], ["omie", { sendEmail: "true" }]] as const) {
    const result = restoreFiscalProviderEmailRequest(source, { outcome: "accepted", relatedIds: { emailOwner: "provider", ...metadata } } as never, provider);
    assert.equal(result.requested, true); assert.equal(result.included, true); assert.equal("delivered" in result, false); assert.equal("accepted" in result, false);
  }
  assert.equal(restoreFiscalProviderEmailRequest(source, { outcome: "unknown", relatedIds: { emailOwner: "provider", sendEmail: "true", includedEmail: "true" } } as never, "focus").included, false);
  assert.equal(restoreFiscalProviderEmailRequest(source, null, "focus").included, false);
  assert.equal(restoreFiscalProviderEmailRequest(envelope(), null, "omie").reasonCode, "fiscal_email_destination_unavailable");
  assert.throws(() => restoreFiscalProviderEmailRequest(source, { outcome: "accepted", relatedIds: { emailOwner: "zyon", sendEmail: "true" } } as never, "bling"), /ownership/);
});
