import test from "node:test";
import assert from "node:assert/strict";
import { OrderNotificationWhatsAppAdapter } from "./order-notification-whatsapp.adapter.js";
import type { NotificationWhatsAppInput } from "../../application/ports/notification-whatsapp-sender.port.js";
import { WhatsAppDeliveryService } from "../../../whatsapp-channel/application/services/whatsapp-delivery.service.js";
import { HandleStatusUpdateUseCase } from "../../../whatsapp-channel/application/use-cases/handle-status-update.use-case.js";

const recipient = "+5521993001883", sender = "+5521971191446";
const input: NotificationWhatsAppInput = { merchantId: "merchant-a", orderId: "order-1", idempotencyKey: "order-1",
  type: "merchant_order_paid", toPhone: recipient, freeformText: "Novo pedido #1001: R$ 3,00" };
const connection = () => ({ id: "config-a", merchantId: "merchant-a", provider: "META_CLOUD", enabled: true, status: "ACTIVE",
  whatsappNumber: sender, credentials: { accessToken: "unit-token", wabaId: "123456789", phoneNumberId: "987654321" } });
const payload = () => ({ provider: "META_CLOUD", merchantId: "merchant-a", deviceId: "META_CLOUD:config-a",
  fromNumber: recipient.slice(1), timestamp: Date.now() - 60_000 });

function fixture() {
  const state: any = { row: null, rows: new Map(), requests: [], templateCalls: [], queries: [], receiptQueries: [], inboxWrites: 0,
    config: connection(), inbound: { payload: payload() },
    merchant: { name: "Loja A", budgetWhatsapp: null, storeSettings: { company: { phone: recipient } } },
    http: async () => new Response(JSON.stringify({ messages: [{ id: "wamid.merchant" }] }), { status: 200 }),
    templateResult: { status: "sent", channel: "whatsapp_template", messageId: "wamid.buyer" }, configReads: 0 };
  const prisma: any = {
    merchant: { findUnique: async () => state.merchant },
    whatsAppWebhookInbox: {
      findFirst: async (query: unknown) => { state.queries.push(query); return state.inbound; },
      updateMany: async () => { state.inboxWrites++; return { count: 0 }; },
    },
    $queryRaw: async (query: any) => {
      state.receiptQueries.push(query);
      assert.match(query.strings.join("?"), /FOR UPDATE/);
      return [...state.rows.values()].filter((row: any) => query.values.includes(row.merchantId) && query.values.includes(row.configId)
        && (query.values.includes(row.id) || query.values.includes(row.providerMessageId))).map((row: any) => ({
          id: row.id, merchant_id: row.merchantId, config_id: row.configId, state: row.state,
          response: structuredClone(row.response), provider_message_id: row.providerMessageId,
        }));
    },
    whatsAppDelivery: {
      findUnique: async ({ where }: any) => state.rows.get(where.id) ?? null,
      findFirst: async () => state.row,
      create: async ({ data }: any) => { if (state.rows.has(data.id)) throw Object.assign(Error("duplicate"), { code: "P2002" }); state.row = { ...data, providerMessageId: null }; state.rows.set(data.id, state.row); return state.row; },
      updateMany: async ({ where, data }: any) => {
        if (state.failFinalization) throw Error("persistence_unavailable");
        if (!state.row || Object.entries(where).some(([key, value]) => state.row[key] !== value)) return { count: 0 };
        Object.assign(state.row, data); return { count: 1 };
      },
      update: async ({ data }: any) => { Object.assign(state.row, data); return state.row; },
    },
    $transaction: async (run: any) => run(prisma),
  };
  const configs: any = { findByMerchantId: async () => { state.configReads++; if (state.beforeConfigRead) state.beforeConfigRead(state.configReads); return state.changeConfig && state.configReads > 1 ? state.changeConfig : state.config; } };
  const templates: any = { execute: async (request: unknown) => {
    state.templateCalls.push(request); if (state.beforeTemplateReturn) await state.beforeTemplateReturn(); return state.templateResult;
  } };
  return { state, prisma, adapter: new OrderNotificationWhatsAppAdapter(prisma, configs, templates) };
}

async function withProvider<T>(state: any, run: () => Promise<T>) {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    state.requests.push({ url, body: JSON.parse(String(options.body)) });
    return state.http();
  }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

test("merchant Meta acceptance persists a scoped order ledger and replay never sends twice", async () => {
  const { state, adapter } = fixture();
  await withProvider(state, async () => {
    const accepted = await adapter.execute(input);
    assert.deepEqual(accepted, { status: "accepted", channel: "whatsapp_session", messageId: "wamid.merchant" });
    assert.deepEqual(await adapter.execute(input), accepted);
  });
  assert.equal(state.requests.length, 1);
  assert.match(state.row.id, /^order_notification:[a-f0-9]{64}$/);
  assert.equal(state.row.state, "sent");
  assert.equal(state.row.response.orderId, "order-1");
  assert.equal(state.row.response.type, "merchant_order_paid");
  assert.equal(state.row.response.status, "accepted");
  assert.equal(state.requests[0].body.to, recipient.slice(1));
  assert.equal(state.requests[0].body.biz_opaque_callback_data, state.row.id);
  assert.equal(state.requests[0].body.type, "text");
  assert.equal(JSON.stringify(state.row.response).includes(recipient.slice(1)), false);
  assert.equal(JSON.stringify(state.row.response).includes(input.freeformText!), false);
  const where = state.queries[0].where;
  assert.deepEqual([where.merchantId, where.configId, where.deviceId, where.kind], ["merchant-a", "config-a", "META_CLOUD:config-a", "message"]);
  assert.deepEqual(where.AND.slice(0, 3).map((entry: any) => entry.payload), [
    { path: ["provider"], equals: "META_CLOUD" }, { path: ["merchantId"], equals: "merchant-a" },
    { path: ["deviceId"], equals: "META_CLOUD:config-a" },
  ]);
});

for (const [label, http] of [
  ["timeout", async () => { throw Error("timeout"); }],
  ["malformed 2xx", async () => new Response("{}", { status: 200 })],
  ["empty provider ID", async () => new Response(JSON.stringify({ messages: [{ id: " " }] }), { status: 200 })],
  ["server error", async () => new Response("{}", { status: 503 })],
] as const) test(`${label} remains unknown and cannot be replayed automatically`, async () => {
  const { state, adapter } = fixture(); state.http = http;
  await withProvider(state, async () => {
    assert.equal((await adapter.execute(input)).status, "unknown");
    assert.equal((await adapter.execute(input)).status, "unknown");
  });
  assert.equal(state.row.state, "submission_unknown");
  assert.equal(state.row.providerMessageId, null);
  assert.equal(state.requests.length, 1);
});

for (const [label, alter] of [
  ["another tenant", (s: any) => { s.config.merchantId = "merchant-other"; }],
  ["another provider", (s: any) => { s.config.provider = "BUBBLEWHATS"; }],
  ["inactive connection", (s: any) => { s.config.status = "INACTIVE"; }],
  ["missing credentials", (s: any) => { s.config.credentials.accessToken = ""; }],
  ["self sender", (s: any) => { s.merchant.storeSettings.company.phone = sender; }],
  ["no operational phone", (s: any) => { s.merchant.storeSettings.company.phone = ""; }],
  ["unidentified sender", (s: any) => { s.config.whatsappNumber = undefined; }],
  ["missing inbox", (s: any) => { s.inbound = null; }],
  ["foreign inbox provider", (s: any) => { s.inbound.payload.provider = "BUBBLEWHATS"; }],
  ["foreign inbox merchant", (s: any) => { s.inbound.payload.merchantId = "merchant-other"; }],
  ["foreign inbox device", (s: any) => { s.inbound.payload.deviceId = "META_CLOUD:other"; }],
  ["foreign inbox recipient", (s: any) => { s.inbound.payload.fromNumber = "5521988888888"; }],
  ["expired inbox", (s: any) => { s.inbound.payload.timestamp = Date.now() - 24 * 60 * 60_000 - 1; }],
  ["future inbox", (s: any) => { s.inbound.payload.timestamp = Date.now() + 60_000; }],
  ["untyped timestamp", (s: any) => { s.inbound.payload.timestamp = String(Date.now()); }],
  ["fractional timestamp", (s: any) => { s.inbound.payload.timestamp = Date.now() - 0.5; }],
] as const) test(`${label} authorizes no merchant freeform, ledger write or template send`, async () => {
  const { state, adapter } = fixture(); alter(state);
  await withProvider(state, async () => assert.equal((await adapter.execute(input)).status, "skipped"));
  assert.equal(state.row, null);
  assert.equal(state.requests.length, 0);
  assert.equal(state.templateCalls.length, 0);
});

test("a changed merchant connection after admission cannot dispatch", async () => {
  const { state, adapter } = fixture(); state.changeConfig = { ...connection(), credentials: { ...connection().credentials, phoneNumberId: "111111111" } };
  await withProvider(state, async () => assert.equal((await adapter.execute(input)).status, "skipped"));
  assert.equal(state.requests.length, 0);
  assert.equal(state.row.state, "notification_skipped");
});

test("definitive Meta rejection is failed rather than delivery or unknown", async () => {
  const { state, adapter } = fixture(); state.http = async () => new Response("{}", { status: 403 });
  await withProvider(state, async () => assert.equal((await adapter.execute(input)).status, "failed"));
  assert.equal(state.row.state, "notification_failed");
  assert.equal(state.row.providerMessageId, null);
});

test("concurrent order notifications cross the provider boundary once", async () => {
  const { state, adapter } = fixture();
  await withProvider(state, async () => {
    const results = await Promise.all([adapter.execute(input), adapter.execute(input)]);
    assert.equal(results.filter(result => result.status === "accepted").length, 1);
    assert.equal(results.filter(result => result.status === "unknown").length, 1);
  });
  assert.equal(state.requests.length, 1);
});

test("provider acceptance followed by a DB acknowledgment loss never replays", async () => {
  const { state, adapter } = fixture(); state.failFinalization = true;
  await withProvider(state, async () => {
    await assert.rejects(adapter.execute(input), /persistence_unavailable/);
    state.failFinalization = false;
    assert.equal((await adapter.execute(input)).status, "unknown");
  });
  assert.equal(state.requests.length, 1);
  assert.equal(state.row.state, "sending");
});

test("authenticated Meta receipts reconcile an unknown order notification without replay", async () => {
  const { state, prisma, adapter } = fixture(); state.http = async () => { throw Error("timeout"); };
  await withProvider(state, async () => {
    assert.equal((await adapter.execute(input)).status, "unknown");
    const delivery = new WhatsAppDeliveryService(prisma, {} as any);
    await delivery.reconcileMeta("merchant-a", "config-a", { id: "wamid.reconciled", status: "delivered", biz_opaque_callback_data: state.row.id });
    assert.equal(state.row.state, "submission_unknown");
    await new HandleStatusUpdateUseCase(prisma).receiveMetaReceipt({ merchantId: "merchant-a", configId: "config-a",
      messageId: "wamid.reconciled", status: "delivered", correlationId: state.row.id, timestamp: "1793389800" });
    assert.equal((await adapter.execute(input)).status, "accepted");
  });
  assert.equal(state.requests.length, 1);
  assert.equal(state.row.providerMessageId, "wamid.reconciled");
  assert.equal(state.row.response.receipt.status, "delivered"); assert.equal(state.inboxWrites, 0);
});

for (const providerReturns of ["accepted", "unknown", "failed"] as const) {
  for (const receiptStatus of ["delivered", "failed"] as const) {
    test(`an early ${receiptStatus} callback survives a late ${providerReturns} provider result without replay`, async () => {
      const { state, prisma, adapter } = fixture();
      state.http = async () => {
        await new HandleStatusUpdateUseCase(prisma).receiveMetaReceipt({ merchantId: "merchant-a", configId: "config-a",
          messageId: "wamid.early", status: receiptStatus, correlationId: state.row.id, timestamp: "1793389800",
          ...(receiptStatus === "failed" ? { errorCode: 131053 } : {}) });
        if (providerReturns === "unknown") throw Error("late_timeout");
        if (providerReturns === "failed") return new Response("{}", { status: 403 });
        return new Response(JSON.stringify({ messages: [{ id: "wamid.late-different" }] }), { status: 200 });
      };
      await withProvider(state, async () => {
        const result = await adapter.execute(input);
        assert.equal(result.status, receiptStatus === "failed" ? "failed" : "accepted");
        assert.equal(result.messageId, "wamid.early");
        if (receiptStatus === "failed") assert.equal(result.reason, "provider_delivery_failed");
        assert.deepEqual(await adapter.execute(input), result);
      });
      assert.equal(state.requests.length, 1); assert.equal(state.inboxWrites, 0);
      assert.equal(state.row.providerMessageId, "wamid.early");
      assert.equal(state.row.response.receipt.status, receiptStatus);
      assert.equal(state.row.state, receiptStatus === "failed" ? "notification_delivery_failed" : "sent");
    });
  }
}

test("known order IDs without opaque correlation bypass generic inbox reconciliation", async () => {
  const { state, prisma, adapter } = fixture();
  await withProvider(state, async () => { await adapter.execute(input); });
  const delivery = new WhatsAppDeliveryService(prisma, {} as any);
  await delivery.reconcileMeta("merchant-a", "config-a", { id: state.row.providerMessageId, status: "read" });
  assert.equal(state.inboxWrites, 0); assert.equal(state.row.response.receipt, undefined);
  await new HandleStatusUpdateUseCase(prisma).receiveMetaReceipt({ merchantId: "merchant-a", configId: "config-a",
    messageId: state.row.providerMessageId, status: "read", timestamp: "1793389800" });
  assert.equal(state.row.response.receipt.status, "read"); assert.equal(state.inboxWrites, 0);
});

test("an early buyer template receipt survives an unknown template result without another send", async () => {
  const { state, prisma, adapter } = fixture();
  state.templateResult = { status: "uncertain", channel: "whatsapp_template" };
  state.beforeTemplateReturn = async () => new HandleStatusUpdateUseCase(prisma).receiveMetaReceipt({
    merchantId: "merchant-a", configId: "config-a", messageId: "wamid.buyer.early", status: "delivered",
    correlationId: state.row.id, timestamp: "1793389800",
  });
  const buyer = { ...input, type: "order_confirmation" as const };
  const result = await adapter.execute(buyer);
  assert.deepEqual(result, { status: "accepted", channel: "whatsapp_template", messageId: "wamid.buyer.early" });
  assert.deepEqual(await adapter.execute(buyer), result);
  assert.equal(state.templateCalls.length, 1); assert.equal(state.requests.length, 0); assert.equal(state.inboxWrites, 0);
  assert.equal(state.row.response.receipt.status, "delivered");
});

test("buyer dispatch retains the approved-template path, branding and receipt correlation", async () => {
  const { state, adapter } = fixture();
  const buyer = { ...input, type: "order_confirmation" as const, variables: { buyerName: "Ana", storeName: "Wrong tenant" }, fallbackEmail: "buyer@example.test" };
  await withProvider(state, async () => {
    assert.equal((await adapter.execute(buyer)).status, "accepted");
    assert.equal((await adapter.execute(buyer)).status, "accepted");
  });
  assert.equal(state.requests.length, 0);
  assert.equal(state.templateCalls.length, 1);
  assert.equal(state.templateCalls[0].type, "order_confirmation");
  assert.equal(state.templateCalls[0].variables.storeName, "Loja A");
  assert.equal(state.templateCalls[0].fallbackEmail, undefined);
  assert.equal(state.templateCalls[0].correlationId, state.row.id);
  assert.equal(state.row.response.channel, "whatsapp_template");
});

test("a buyer template uncertainty cannot switch to freeform, email or replay", async () => {
  const { state, adapter } = fixture(); state.templateResult = { channel: "whatsapp_template", status: "uncertain" };
  await withProvider(state, async () => {
    assert.equal((await adapter.execute({ ...input, type: "order_confirmation" })).status, "unknown");
    assert.equal((await adapter.execute({ ...input, type: "order_confirmation" })).status, "unknown");
  });
  assert.equal(state.requests.length, 0);
  assert.equal(state.templateCalls.length, 1);
});

test("the durable key separates orders and buyer/merchant notification types at the same destination", async () => {
  const { state, adapter } = fixture();
  await withProvider(state, async () => {
    await adapter.execute(input);
    await adapter.execute({ ...input, type: "order_confirmation" });
    await adapter.execute({ ...input, orderId: "order-2", idempotencyKey: "order-1" });
  });
  assert.equal(state.rows.size, 3);
  assert.equal(new Set([...state.rows.values()].map((row: any) => row.id)).size, 3);
  assert.equal(state.requests.length, 2);
  assert.equal(state.templateCalls.length, 1);
});

test("a Meta connection with a persisted device identity uses the authenticated inbox device", async () => {
  const { state, adapter } = fixture();
  state.config.deviceId = "persisted-device";
  state.inbound.payload.deviceId = "persisted-device";
  await withProvider(state, async () => assert.equal((await adapter.execute(input)).status, "accepted"));
  assert.equal(state.queries[0].where.deviceId, "persisted-device");
  assert.equal(state.row.deviceId, "persisted-device");
});

test("an operational contact changed after admission cannot receive the old notification", async () => {
  const { state, adapter } = fixture();
  state.beforeConfigRead = (read: number) => { if (read === 2) state.merchant.storeSettings.company.phone = "+5511988887777"; };
  await withProvider(state, async () => assert.equal((await adapter.execute(input)).reason, "merchant_recipient_changed"));
  assert.equal(state.requests.length, 0);
  assert.equal(state.row.state, "notification_skipped");
});
