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
  state.order = { id: "db-order-1", merchantId: "merchant-a", sessionId: "session-a", externalOrderId: "order-1", status: "approved" };
  state.confirmation = { payload: { type: "ORDER_CONFIRMATION", merchantId: "merchant-a", orderId: "order-1", buyerPhone: recipient } };
  state.receipt = { merchantId: "merchant-a", orderId: "order-1", buyerPhone: recipient,
    paidReceipt: { status: "itemized", currency: "BRL", totalPaidCents: 1385 } };
  const prisma: any = {
    completedOrder: { findFirst: async (query: unknown) => { state.orderQuery = query; return state.order; } },
    outboxMessage: { findFirst: async (query: unknown) => { state.orderEventQuery = query; return state.confirmation; } },
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
  const receipts: any = { read: async (query: unknown) => { state.receiptQuery = query; return state.receipt; } };
  return { state, prisma, adapter: new OrderNotificationWhatsAppAdapter(prisma, configs, templates, receipts) };
}

function itemizedBuyerReceipt(state: any) {
  state.receipt = { ...state.receipt, type: "ORDER_CONFIRMATION", orderNumber: "order-1", buyerName: "Diego Costa - Wrong store",
    merchantName: "Wrong store", currency: "BRL", total: "12.86",
    items: [{ name: "QA Físico R$3", quantity: 1, price: "3,00", productType: "physical" }],
    paidReceipt: { status: "itemized", currency: "BRL", itemsSubtotalCents: 300, discountCents: 30,
      shippingCents: 1016, platformFeeCents: 99, merchantOrderTotalCents: 1286, totalPaidCents: 1385 } };
}

test("an owned itemized buyer receipt uses the authenticated service window and canonical rich message once", async () => {
  const { state, adapter } = fixture(); itemizedBuyerReceipt(state);
  const request = { ...input, type: "order_confirmation" as const, freeformText: "untrusted override", variables: { storeName: "wrong" } };
  await withProvider(state, async () => {
    assert.equal((await adapter.execute(request)).channel, "whatsapp_session");
    assert.equal((await adapter.execute(request)).channel, "whatsapp_session");
  });
  assert.equal(state.requests.length, 1); assert.equal(state.templateCalls.length, 0);
  const body = state.requests[0].body;
  assert.equal(body.to, recipient.slice(1)); assert.equal(body.type, "text");
  assert.match(body.text.body, /^🤖 ✅ \*Pagamento aprovado!\*/);
  assert.match(body.text.body, /\*Loja A\*/); assert.match(body.text.body.replace(/\u00a0/g, " "), /Total pago: R\$ 13,85/);
  assert.doesNotMatch(body.text.body, /untrusted override|Wrong store|preparando/);
  assert.equal(state.row.response.channel, "whatsapp_session");
  assert.equal(JSON.stringify(state.row.response).includes(body.text.body), false);
});

for (const type of ["order_confirmation", "order_nonphysical_confirmation"] as const) {
  test(`signed ${type} session receipt survives an early READ callback and prevents replay`, async () => {
    const { state, prisma, adapter } = fixture(); itemizedBuyerReceipt(state);
    if (type === "order_nonphysical_confirmation") state.receipt.items[0].productType = "digital";
    const messageId = "wamid.buyer.rich." + type;
    state.http = async () => {
      await new HandleStatusUpdateUseCase(prisma).receiveMetaReceipt({ merchantId: "merchant-a", configId: "config-a",
        correlationId: state.row.id, messageId, status: "read", timestamp: "1793407439" });
      return new Response(JSON.stringify({ messages: [{ id: messageId }] }), { status: 200 });
    };
    await withProvider(state, async () => {
      const request = { ...input, type };
      assert.deepEqual(await adapter.execute(request), { status: "accepted", channel: "whatsapp_session", messageId });
      assert.deepEqual(await adapter.execute(request), { status: "accepted", channel: "whatsapp_session", messageId });
    });
    assert.equal(state.row.response.receipt?.status, "read");
    assert.equal(state.row.response.channel, "whatsapp_session");
    assert.equal(state.row.providerMessageId, messageId);
    assert.equal(state.requests.length, 1); assert.equal(state.templateCalls.length, 0);
    assert.equal(state.inboxWrites, 0);
  });
}

for (const change of [
  (s: any) => { s.receipt.buyerPhone = "+5511988887777"; },
  (s: any) => { s.receipt.merchantId = "other"; },
  (s: any) => { s.receipt.orderId = "other"; },
  (s: any) => { s.receipt.paidReceipt = undefined; },
  (s: any) => { s.order.status = "cancelled"; },
  (s: any) => { s.order.merchantId = "other"; },
]) test("a buyer receipt cannot bypass canonical ownership/payment/order guards", async () => {
  const { state, adapter } = fixture(); itemizedBuyerReceipt(state); change(state);
  await withProvider(state, async () => assert.equal((await adapter.execute({ ...input, type: "order_confirmation" })).status, "skipped"));
  assert.equal(state.requests.length + state.templateCalls.length, 0); assert.equal(state.row, null);
});

test("an expired service window retains approved templates and never changes channels after an uncertain result", async () => {
  const { state, adapter } = fixture(); itemizedBuyerReceipt(state);
  state.inbound.payload.timestamp = Date.now() - 25 * 60 * 60_000;
  state.templateResult = { status: "uncertain", channel: "whatsapp_template" };
  await withProvider(state, async () => {
    assert.equal((await adapter.execute({ ...input, type: "order_confirmation" })).status, "unknown");
    state.inbound.payload.timestamp = Date.now() - 1_000;
    assert.equal((await adapter.execute({ ...input, type: "order_confirmation" })).status, "unknown");
  });
  assert.equal(state.requests.length, 0); assert.equal(state.templateCalls.length, 1);
});

test("buyer receipt revalidates canonical scope before dispatch and never retries a rejected session message as a template", async () => {
  for (const revoked of [true, false]) {
    const { state, adapter } = fixture(); itemizedBuyerReceipt(state);
    if (revoked) state.beforeConfigRead = (count: number) => { if (count === 2) state.receipt.buyerPhone = "+5511988887777"; };
    else state.http = async () => new Response("rejected", { status: 400 });
    await withProvider(state, async () => {
      assert.equal((await adapter.execute({ ...input, type: "order_confirmation" })).status, revoked ? "skipped" : "failed");
      await adapter.execute({ ...input, type: "order_confirmation" });
    });
    assert.equal(state.requests.length, revoked ? 0 : 1); assert.equal(state.templateCalls.length, 0);
  }
});

async function withProvider<T>(state: any, run: () => Promise<T>) {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    state.requests.push({ url, body: JSON.parse(String(options.body)) });
    return state.http();
  }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

async function withAnimationProvider<T>(state: any, run: () => Promise<T>) {
  const previous = process.env.API_PUBLIC_URL;
  process.env.API_PUBLIC_URL = "https://api.example.test/";
  try { return await withProvider(state, run); }
  finally { if (previous === undefined) delete process.env.API_PUBLIC_URL; else process.env.API_PUBLIC_URL = previous; }
}

test("paid animation has a separate immutable order ledger and corrections cannot resend its sticker", async () => {
  const { state, adapter } = fixture();
  await withAnimationProvider(state, async () => {
    const request = { ...input, type: "order_paid_animation" as const };
    const accepted = await adapter.execute(request);
    assert.equal(accepted.status, "accepted");
    assert.deepEqual(await adapter.execute({ ...request, idempotencyKey: "qa-order-receipt-correction-v1:order-1" }), accepted);
  });
  assert.equal(state.requests.length, 1); assert.equal(state.templateCalls.length, 0);
  assert.equal(state.requests[0].body.type, "sticker");
  assert.deepEqual(state.requests[0].body.sticker, { link: "https://api.example.test/whatsapp/presentation/payment-paid-v1.webp" });
  assert.equal(state.row.response.type, "order_paid_animation"); assert.equal(state.row.response.channel, "whatsapp_session");
  assert.equal(state.row.response.orderId, "order-1"); assert.equal(state.row.response.receipt, undefined);
  assert.deepEqual(state.receiptQuery, { merchantId: "merchant-a", externalOrderId: "order-1" });
});

test("shipped animation binds canonical ID to external order and requires actual shipped state", async () => {
  const { state, adapter } = fixture(); state.order.status = "shipped";
  await withAnimationProvider(state, async () => {
    assert.equal((await adapter.execute({ ...input, orderId: "db-order-1", type: "order_shipped_animation" })).status, "accepted");
    assert.equal((await adapter.execute({ ...input, orderId: "order-1", type: "order_shipped_animation" })).status, "accepted");
  });
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].body.type, "sticker");
  assert.deepEqual(state.requests[0].body.sticker, { link: "https://api.example.test/whatsapp/presentation/order-shipped-v1.webp" });
  assert.equal(state.row.response.orderId, "order-1"); assert.equal(state.row.response.type, "order_shipped_animation");
  assert.equal(state.orderEventQuery.where.merchantId, "merchant-a");
  assert.equal(state.orderEventQuery.where.eventType, "order.confirmed");
});

for (const [label, change] of [
  ["foreign order", (s: any) => { s.order.merchantId = "other"; }],
  ["missing order", (s: any) => { s.order = null; }],
  ["another order ID", (s: any) => { s.order.externalOrderId = "other"; }],
  ["unapproved payment", (s: any) => { s.receipt.paidReceipt = undefined; }],
  ["foreign payment owner", (s: any) => { s.receipt.merchantId = "other"; }],
  ["another payment order", (s: any) => { s.receipt.orderId = "other"; }],
  ["another buyer", (s: any) => { s.receipt.buyerPhone = "+5511988887777"; }],
  ["cancelled order", (s: any) => { s.order.status = "cancelled"; }],
  ["self sender", (s: any) => { s.config.whatsappNumber = recipient; }],
  ["sender unknown", (s: any) => { s.config.whatsappNumber = undefined; }],
  ["sender malformed", (s: any) => { s.config.whatsappNumber = "unidentified"; }],
  ["missing authenticated inbox", (s: any) => { s.inbound = null; }],
  ["wrong inbox tenant", (s: any) => { s.inbound.payload.merchantId = "other"; }],
  ["wrong inbox device", (s: any) => { s.inbound.payload.deviceId = "other"; }],
  ["expired inbox", (s: any) => { s.inbound.payload.timestamp = Date.now() - 24 * 60 * 60_000; }],
  ["future inbox", (s: any) => { s.inbound.payload.timestamp = Date.now() + 60_000; }],
] as const) test(`paid animation ${label} never authorizes a send or claims delivery`, async () => {
  const { state, adapter } = fixture(); change(state);
  await withAnimationProvider(state, async () => assert.equal((await adapter.execute({ ...input, type: "order_paid_animation" })).status, "skipped"));
  assert.equal(state.requests.length + state.templateCalls.length, 0); assert.equal(state.row, null);
});

for (const status of ["approved", "pending", "preparing", "cancelled", "delivered"]) test(`order state ${status} cannot announce shipment`, async () => {
  const { state, adapter } = fixture(); state.order.status = status;
  await withAnimationProvider(state, async () => assert.equal((await adapter.execute({ ...input, type: "order_shipped_animation" })).status, "skipped"));
  assert.equal(state.requests.length, 0); assert.equal(state.row, null);
});

test("shipped animation rejects a different historical buyer or missing order contact snapshot", async () => {
  for (const confirmation of [null, { payload: { type: "ORDER_CONFIRMATION", merchantId: "other", orderId: "order-1", buyerPhone: recipient } },
    { payload: { type: "ORDER_CONFIRMATION", merchantId: "merchant-a", orderId: "order-1", buyerPhone: "+5511988887777" } }]) {
    const { state, adapter } = fixture(); state.order.status = "shipped"; state.confirmation = confirmation;
    await withAnimationProvider(state, async () => assert.equal((await adapter.execute({ ...input, type: "order_shipped_animation" })).status, "skipped"));
    assert.equal(state.requests.length, 0); assert.equal(state.row, null);
  }
});

test("animation rechecks payment order scope before dispatch after durable admission", async () => {
  const { state, adapter } = fixture();
  state.beforeConfigRead = (count: number) => { if (count === 2) state.order.status = "cancelled"; };
  await withAnimationProvider(state, async () => assert.equal((await adapter.execute({ ...input, type: "order_paid_animation" })).status, "skipped"));
  assert.equal(state.requests.length, 0); assert.equal(state.row.state, "notification_skipped");
});

test("animation asset URLs require a configured credential-free HTTPS origin", async () => {
  for (const origin of ["http://api.example.test", "https://user:secret@api.example.test", "invalid"]) {
    const { state, adapter } = fixture();
    await withAnimationProvider(state, async () => {
      process.env.API_PUBLIC_URL = origin;
      assert.equal((await adapter.execute({ ...input, type: "order_paid_animation" })).status, "skipped");
    });
    assert.equal(state.requests.length, 0); assert.equal(state.row, null);
  }
});

test("animation unknown acceptance cannot be retried with a different correction purpose", async () => {
  const { state, adapter } = fixture(); state.http = async () => { throw Error("timeout"); };
  await withAnimationProvider(state, async () => {
    assert.equal((await adapter.execute({ ...input, type: "order_paid_animation" })).status, "unknown");
    assert.equal((await adapter.execute({ ...input, type: "order_paid_animation", idempotencyKey: "correction-v2" })).status, "unknown");
  });
  assert.equal(state.requests.length, 1); assert.equal(state.row.state, "submission_unknown");
});

for (const type of ["order_paid_animation", "order_shipped_animation"] as const) test(`${type} authentic Meta receipts reconcile acceptance separately from delivery`, async () => {
  const { state, prisma, adapter } = fixture(); if (type === "order_shipped_animation") state.order.status = "shipped";
  state.http = async () => {
    await new HandleStatusUpdateUseCase(prisma).receiveMetaReceipt({ merchantId: "merchant-a", configId: "config-a",
      messageId: "wamid.animation", status: "read", correlationId: state.row.id, timestamp: "1793394227" });
    throw Error("late_timeout");
  };
  await withAnimationProvider(state, async () => assert.equal((await adapter.execute({ ...input, type })).status, "accepted"));
  assert.equal(state.requests.length, 1); assert.equal(state.row.providerMessageId, "wamid.animation");
  assert.equal(state.row.response.receipt.status, "read"); assert.equal(state.row.response.channel, "whatsapp_session");
});

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
