import assert from "node:assert/strict";
import test from "node:test";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { createOrderHandlers } from "../tool-handlers/order.handlers.js";

const usage = { promptTokens: 5, completionTokens: 5, totalTokens: 10 };
const classification = { intent: "ORDER_STATUS" as const, requiresTool: true, needsProductDiscovery: false };
const badReply = JSON.stringify({ schemaVersion: 1, message: "Ele está com a transportadora Correios e já foi postado. Podemos escolher fones ou acessórios?" });
const input = { merchantId: "merchant", sessionId: "conversation", cartId: "conversation", storeCategory: "others",
  userMessage: "Qual é o status do meu pedido ORDER-OWNED?", buyerContext: { globalUserId: "buyer" }, history: [
    { role: "user" as const, content: "Preciso de ajuda para escolher algo para minha pele." },
    { role: "assistant" as const, content: "Qual é o seu tipo de pele?" },
  ] };

function fixture(options: { status?: string; missing?: boolean; noShipment?: boolean; noBuyer?: boolean; noId?: boolean; error?: boolean; malformed?: boolean; fallback?: boolean } = {}) {
  const reads: string[] = [], requests: any[] = [];
  const canonical = createOrderHandlers({ prisma: {
    completedOrder: { findFirst: async (query: any) => {
      reads.push("order"); assert.deepEqual(query.where, { merchantId: "merchant", externalOrderId: "ORDER-OWNED", session: { globalUserId: "buyer" } });
      if (options.error) throw Error("private_database_error");
      return options.missing ? null : { externalOrderId: "ORDER-OWNED", status: "approved", completedAt: new Date("2026-10-30T21:03:37Z") };
    } },
    shipment: { findFirst: async (query: any) => {
      reads.push("shipment"); assert.deepEqual(query.where, { merchantId: "merchant", externalOrderId: "ORDER-OWNED" });
      return options.noShipment ? null : { id: "shipment", carrier: "Correios", status: options.status ?? "created", trackingCode: "pending:shipment",
        trackingUrl: "https://tracking.example/not-confirmed", estimatedEta: null, deliveredAt: options.status === "delivered" ? new Date("2026-10-31T12:00:00Z") : null,
        updatedAt: new Date("2026-10-30T21:03:38Z") };
    } },
    trackingEvent: { findFirst: async (query: any) => { reads.push("event"); assert.deepEqual(query.where, { merchantId: "merchant", shipmentId: "shipment" }); return null; } },
  } as never }, { merchantId: "merchant", sessionId: "conversation", ...(options.noBuyer ? {} : { buyer: { globalUserId: "buyer" } }) });
  let attempts = 0;
  const provider = { chat: async (request: any) => { requests.push(request); return requests.length === 1
    ? { content: "", toolCalls: [{ id: "track", name: "track_order", args: options.noId ? {} : { orderId: "ORDER-OWNED" } }], usage }
    : { content: badReply, usage }; } };
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    ...canonical, trackOrder: async (args: any) => { attempts++; return options.malformed ? { found: true, carrier: "Correios" } : canonical.trackOrder(args); },
    addItemToCart: async () => assert.fail("tracking cannot write a cart"), createCheckoutSession: async () => assert.fail("tracking cannot create checkout"),
  } as never, provider: options.fallback ? { chat: async () => { throw Error("primary_unavailable"); } } as never : provider as never,
    ...(options.fallback ? { fallbackProvider: provider as never } : {}) }, classification);
  return { reads, requests, agent, attempts: () => attempts };
}

for (const fallback of [false, true]) test(`created is preparation and selected freight, without carrier handoff or unrelated sales (${fallback ? "fallback" : "primary"})`, async () => {
  const f = fixture({ fallback }); const result = await f.agent.run(input);
  assert.match(result.message, /Envio em preparação/); assert.match(result.message, /Frete selecionado.*Correios/);
  assert.match(result.message, /postagem.*não.*confirmada/i); assert.match(result.message, /rastreio.*não.*disponível/i);
  assert.doesNotMatch(result.message, /está com|já foi postado|fones|acessórios|escolher|tracking\.example|pending:/i);
  assert.deepEqual(f.reads, ["order", "shipment", "event"]); assert.equal(f.attempts(), 1); assert.equal(f.requests.length, 1);
  assert.deepEqual(result.toolsUsed, ["track_order"]); assert.equal(result.safetyValidation.safe, true);
});

for (const [status, label] of [["label_generated", "Etiqueta de envio gerada"], ["dispatched", "Pedido despachado"], ["delivered", "Entregue"]] as const)
  test(`the real owned handler keeps ${status} distinct in the canonical status message`, async () => {
    const f = fixture({ status }); const result = await f.agent.run(input);
    assert.match(result.message, new RegExp(label)); assert.doesNotMatch(result.message, /fones|acessórios|já foi postado/);
    if (status === "label_generated") assert.match(result.message, /Frete selecionado.*Correios/);
    else { assert.match(result.message, /Transportadora.*Correios/); assert.doesNotMatch(result.message, /postagem.*não.*confirmada/i); }
    assert.equal(f.attempts(), 1); assert.equal(f.requests.length, 1);
  });

test("an approved order without shipment keeps payment and unavailable tracking separate", async () => {
  const f = fixture({ noShipment: true }); const result = await f.agent.run(input);
  assert.match(result.message, /Pagamento.*aprovado/); assert.match(result.message, /rastreio.*não.*disponível/i);
  assert.doesNotMatch(result.message, /Correios|fones|acessórios|despachado|postado/); assert.deepEqual(f.reads, ["order", "shipment"]); assert.equal(f.requests.length, 1);
});

for (const options of [{ missing: true }, { noBuyer: true }, { noId: true }]) test(`foreign/missing/anonymous order stays scoped and canonical: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); const result = await f.agent.run(input);
  assert.match(result.message, options.missing ? /Não encontrei esse pedido na sua conta/ : options.noBuyer ? /entre na sua conta/ : /Informe o número do pedido/);
  assert.doesNotMatch(result.message, /Correios|fones|acessórios|já foi postado/); assert.equal(f.requests.length, 1); assert.equal(f.attempts(), 1);
  assert.equal(f.reads.length, options.missing ? 1 : 0);
});

for (const options of [{ error: true }, { malformed: true }]) test(`failed or malformed owned reads never fabricate status or repeat the handler: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); const result = await f.agent.run(input);
  assert.equal(f.attempts(), 1); assert.equal(result.safetyValidation.safe, false);
  assert.match(result.message, /Não consegui carregar/);
  assert.doesNotMatch(result.message, /Correios|fones|acessórios|postado|private_database_error/);
});
