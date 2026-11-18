// UNEXECUTED source candidate. Native tenant/channel HTTP query proof is separate.
import assert from "node:assert/strict";
import test from "node:test";
import { publicConversationMessage } from "./whatsapp-conversation-projection.js";
const base = { id: "message", ticketId: "ticket", senderType: "merchant", content: "Actual persisted text", createdAt: new Date("2026-11-16T10:00:00Z") };
test("T58 public WhatsApp message projection", async t => {
  await t.test("exposes only true status and revision, excluding original55command/receipt proof", () => {
    for (const status of ["queued", "accepted", "delivered", "read", "failed", "unknown"]) {
      const raw = { ...base, response: { purpose: "support_message", authority: { credentialDigest: "private-canary" } },
        metadata: { kind: "whatsapp_outgoing", schemaVersion: 1, clientMessageId: "client-original-123", bindingId: "private-binding",
          inboxId: "private-inbox", leaseToken: "private-lease", delivery: { status, revision: 8, providerMessageId: "private-provider-id", originalAttempt: "private-attempt" } } };
      assert.deepEqual(publicConversationMessage(raw, "ticket"), { ...base, createdAt: base.createdAt.toISOString(), clientMessageId: "client-original-123", delivery: { status, revision: 8 } });
      assert.equal(JSON.stringify(publicConversationMessage(raw, "ticket")).includes("private-"), false);
    }
  });
  await t.test("does not invent a delivery state for incoming/system history", () => {
    const row = publicConversationMessage({ ...base, senderType: "buyer", metadata: { kind: "whatsapp_incoming", origin: "voice", inboxId: "private", leaseToken: "private" } }, "ticket");
    assert.equal(row.origin, "voice");assert.equal(row.delivery, undefined);assert.equal(row.clientMessageId, undefined);
  });
  await t.test("fails malformed or cross-ticket facts instead of returning empty/received success", () => {
    assert.throws(() => publicConversationMessage(base, "other-ticket"));
    for (const delivery of [{ status: "received", revision: 1 }, { status: "read", revision: -1 }, { status: "accepted" }, { status: "delivered", revision: 1.5 }])
      assert.throws(() => publicConversationMessage({ ...base, metadata: { kind: "whatsapp_outgoing", schemaVersion: 1, clientMessageId: "client-original-123", delivery } }, "ticket"), /invalid_whatsapp_delivery_projection/);
  });
});
