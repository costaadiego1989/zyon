import assert from "node:assert/strict";
import test from "node:test";
import { HandleStatusUpdateUseCase } from "./handle-status-update.use-case.js";

const correlationId = "order_notification:" + "a".repeat(64);
const input = { merchantId: "merchant", configId: "config", messageId: "wamid.order", correlationId, status: "delivered", timestamp: "1793389800" };
const metadata = () => ({ kind: "order_notification", orderId: "ORD-EXTERNAL-1", type: "merchant_order_paid",
  channel: "whatsapp_session", recipientHash: "b".repeat(64), status: "accepted" });

function fixture(state = "sent", providerMessageId: string | null = "wamid.order") {
  const saved: any = { id: correlationId, merchantId: "merchant", configId: "config", state, providerMessageId, response: metadata() };
  const audit: any = { selects: [], writes: [], inboxWrites: 0, rows: [saved] };
  const tx: any = {
    $queryRaw: async (query: any) => {
      audit.selects.push(query);
      assert.match(query.strings.join("?"), /FOR UPDATE/);
      assert.ok(query.values.includes("merchant") || query.values.includes("foreign"));
      const merchant = query.values.includes("foreign") ? "foreign" : "merchant";
      const config = query.values.includes("other-config") ? "other-config" : "config";
      return audit.rows.filter((row: any) => row.merchantId === merchant && row.configId === config
        && (query.values.includes(row.id) || query.values.includes(row.providerMessageId))).map((row: any) => ({
          id: row.id, merchant_id: row.merchantId, config_id: row.configId, state: row.state,
          provider_message_id: row.providerMessageId, response: structuredClone(row.response),
        }));
    },
    whatsAppDelivery: { updateMany: async ({ where, data }: any) => {
      audit.writes.push({ where, data: structuredClone(data) });
      if (audit.loseWrite) return { count: 0 };
      if (Object.entries(where).some(([key, value]) => saved[key] !== value)) return { count: 0 };
      Object.assign(saved, structuredClone(data)); return { count: 1 };
    } },
    whatsAppWebhookInbox: { updateMany: async () => { audit.inboxWrites++; throw Error("receipt_must_not_reopen_inbox"); } },
  };
  return { saved, audit, uc: new HandleStatusUpdateUseCase({ $transaction: async (run: any) => run(tx) } as any) };
}

test("an accepted order gains a durable delivery receipt rather than only provider acceptance", async () => {
  const { saved, audit, uc } = fixture();
  await uc.receiveMetaReceipt(input);
  assert.deepEqual(saved.response.receipt, { status: "delivered", timestamp: input.timestamp, messageId: input.messageId });
  assert.equal(saved.state, "sent"); assert.equal(saved.response.orderId, "ORD-EXTERNAL-1");
  assert.equal(saved.response.status, "accepted"); assert.equal(audit.writes.length, 1); assert.equal(audit.inboxWrites, 0);
  assert.ok(audit.selects[0].values.includes(correlationId)); assert.ok(audit.selects[0].values.includes("config"));
});

test("a receipt recovers sending or unknown acceptance and binds the provider id without inbox replay", async () => {
  for (const state of ["sending", "submission_unknown"]) {
    const { saved, audit, uc } = fixture(state, null);
    await uc.receiveMetaReceipt(input);
    assert.equal(saved.providerMessageId, input.messageId); assert.equal(saved.state, "sent");
    assert.equal(saved.response.status, "accepted"); assert.equal(saved.response.receipt.status, "delivered");
    assert.equal(audit.inboxWrites, 0);
  }
});

test("a legacy unknown none channel is resolved only from an order type in submission_unknown", async () => {
  const { saved, uc } = fixture("submission_unknown", null);
  saved.response.status = "unknown"; saved.response.channel = "none";
  await uc.receiveMetaReceipt(input);
  assert.equal(saved.response.channel, "whatsapp_session"); assert.equal(saved.response.receipt.status, "delivered");
  const rejected = fixture("sent"); rejected.saved.response.status = "unknown"; rejected.saved.response.channel = "none";
  await rejected.uc.receiveMetaReceipt(input); assert.equal(rejected.audit.writes.length, 0);
});

test("failed delivery is explicit, keeps only the numeric error code and never reopens dispatch", async () => {
  const { saved, audit, uc } = fixture("submission_unknown", null);
  await uc.receiveMetaReceipt({ ...input, status: "failed", errorCode: 131053, details: "private recipient" } as any);
  assert.equal(saved.state, "notification_delivery_failed"); assert.equal(saved.providerMessageId, input.messageId);
  assert.equal(saved.response.status, "failed"); assert.equal(saved.response.reason, "provider_delivery_failed");
  assert.deepEqual(saved.response.receipt, { status: "failed", timestamp: input.timestamp, messageId: input.messageId, errorCode: 131053 });
  assert.doesNotMatch(JSON.stringify(saved.response), /private recipient/); assert.equal(audit.inboxWrites, 0);
});

test("delivery receipts are monotonic under duplicated and out of order callbacks", async () => {
  const { saved, audit, uc } = fixture();
  await uc.receiveMetaReceipt({ ...input, status: "read" });
  for (const status of ["sent", "delivered", "failed", "read"]) await uc.receiveMetaReceipt({ ...input, status, timestamp: "1793389900" });
  assert.equal(saved.response.receipt.status, "read"); assert.equal(saved.state, "sent"); assert.equal(audit.writes.length, 1);
});

test("late sent cannot erase a failure, while authenticated delivery can establish success", async () => {
  const { saved, audit, uc } = fixture();
  await uc.receiveMetaReceipt({ ...input, status: "failed", errorCode: 131053 });
  await uc.receiveMetaReceipt({ ...input, status: "sent" });
  assert.equal(saved.state, "notification_delivery_failed"); assert.equal(audit.writes.length, 1);
  await uc.receiveMetaReceipt(input);
  assert.equal(saved.state, "sent"); assert.equal(saved.response.status, "accepted");
  assert.equal(saved.response.reason, undefined); assert.equal(saved.response.receipt.errorCode, undefined);
});

test("missing opaque correlation uses only an already bound scoped order message id", async () => {
  const { saved, audit, uc } = fixture();
  await uc.receiveMetaReceipt({ ...input, correlationId: undefined });
  assert.equal(saved.response.receipt.status, "delivered"); assert.equal(audit.writes.length, 1);
  const unknown = fixture("submission_unknown", null);
  await unknown.uc.receiveMetaReceipt({ ...input, correlationId: undefined });
  assert.equal(unknown.saved.state, "submission_unknown"); assert.equal(unknown.audit.writes.length, 0);
});

for (const [label, change] of [
  ["foreign merchant", { merchantId: "foreign" }], ["foreign config", { configId: "other-config" }],
  ["foreign provider id", { messageId: "wamid.foreign" }], ["foreign correlation", { correlationId: "order_notification:" + "c".repeat(64) }],
  ["malformed correlation", { correlationId: "order_notification:bad" }], ["empty correlation", { correlationId: "" }],
  ["malformed status", { status: "queued" }], ["malformed timestamp", { timestamp: "private text" }],
  ["malformed message id", { messageId: " " }],
] as const) test(`${label} authorizes no order receipt write or provider-id fallback`, async () => {
  const { audit, uc } = fixture(); await uc.receiveMetaReceipt({ ...input, ...change }); assert.equal(audit.writes.length, 0);
});

for (const [label, alter] of [
  ["foreign metadata kind", (s: any) => { s.response.kind = "checkout"; }],
  ["wrong channel for type", (s: any) => { s.response.channel = "whatsapp_template"; }],
  ["missing external order", (s: any) => { delete s.response.orderId; }],
  ["non-order type", (s: any) => { s.response.type = "password_reset"; }],
  ["prior rejected send", (s: any) => { s.state = "notification_failed"; }],
  ["conflicting receipt binding", (s: any) => { s.response.receipt = { messageId: "wamid.foreign", status: "sent" }; }],
] as const) test(`${label} is rejected under the row lock`, async () => {
  const { saved, audit, uc } = fixture(); alter(saved); await uc.receiveMetaReceipt(input); assert.equal(audit.writes.length, 0);
});

test("provider-only fallback refuses ambiguous bindings across order ledger rows", async () => {
  const { audit, uc } = fixture(); audit.rows.push({ ...audit.rows[0], id: "order_notification:" + "d".repeat(64) });
  await uc.receiveMetaReceipt({ ...input, correlationId: undefined }); assert.equal(audit.writes.length, 0);
});

test("provider-only fallback cannot cross merchant, connection or provider id", async () => {
  for (const change of [{ merchantId: "foreign" }, { configId: "other-config" }, { messageId: "wamid.foreign" }]) {
    const { audit, uc } = fixture(); await uc.receiveMetaReceipt({ ...input, ...change, correlationId: undefined });
    assert.equal(audit.writes.length, 0);
  }
});

test("a lost scoped receipt write fails the webhook rather than acknowledging unpersisted evidence", async () => {
  const { audit, uc } = fixture(); audit.loseWrite = true;
  await assert.rejects(uc.receiveMetaReceipt(input), /whatsapp_order_receipt_conflict/);
});

test("buyer approved templates use the same durable receipt with their own channel", async () => {
  const { saved, uc } = fixture(); saved.response.type = "order_confirmation"; saved.response.channel = "whatsapp_template";
  await uc.receiveMetaReceipt(input); assert.equal(saved.response.receipt.status, "delivered");
});
