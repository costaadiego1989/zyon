import test from "node:test";
import assert from "node:assert/strict";
import { SupportHandoffService } from "./support-handoff.service.js";

const metadata = (id: string, extra = {}) => ({ kind: "product_question", schemaVersion: 1, merchantId: "merchant-a", ticketId: "owned-ticket", productId: "product-a", buyerId: "buyer-a",
  sessionId: "conversation-a", questionMessageId: id, questionText: "Pergunta própria?", ...extra });
const row = (id: string, data: unknown) => ({ id, ticketId: "owned-ticket", createdAt: new Date("2026-10-29T12:00:00Z"), metadata: data });

test("personal history scopes the ticket, buyer, product and typed metadata, without attributing legacy text", async () => {
  let query: any;
  const rows = [row("own", metadata("own")), row("other-owner", metadata("other-owner", { buyerId: "buyer-b" })),
    row("other-product", metadata("other-product", { productId: "product-b" })), row("wrong-reference", metadata("different-id")),
    row("other-merchant", metadata("other-merchant", { merchantId: "merchant-b" })),
    row("other-ticket", metadata("other-ticket", { ticketId: "different-ticket" })),
    row("unbound-session", metadata("unbound-session", { sessionId: "" })),
    row("legacy", { kind: "text", authorName: "Nome repetido", content: "Pergunta sobre Produto: Pergunta própria?" })];
  const service = new SupportHandoffService({} as never, {} as never,
    { supportTicketMessage: { findMany: async (input: any) => { query = input; return rows; } } } as never);
  const result = await service.listProductQuestions({ merchantId: "merchant-a", buyerId: "buyer-a", productId: "product-a" });
  assert.deepEqual(query.where.ticket, { merchantId: "merchant-a", buyerId: "buyer-a", source: "widget" });
  assert.equal(query.where.senderType, "buyer");
  assert.deepEqual(query.where.AND, [{ metadata: { path: ["kind"], equals: "product_question" } }, { metadata: { path: ["schemaVersion"], equals: 1 } },
    { metadata: { path: ["merchantId"], equals: "merchant-a" } },
    { metadata: { path: ["productId"], equals: "product-a" } }, { metadata: { path: ["buyerId"], equals: "buyer-a" } }]);
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.deepEqual(result.questions.map(q => q.id), ["own"]);
  assert.equal(result.questions[0]?.answerState, "not_linked");
  assert.equal("answer" in result.questions[0]!, false);
});

test("personal history reports bounded results instead of claiming the complete history", async () => {
  const service = new SupportHandoffService({} as never, {} as never, { supportTicketMessage: { findMany: async (input: any) => {
    assert.equal(input.take, 21); assert.deepEqual(input.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
    return Array.from({ length: 21 }, (_, i) => row(`own-${i}`, metadata(`own-${i}`)));
  } } } as never);
  const result = await service.listProductQuestions({ merchantId: "merchant-a", buyerId: "buyer-a", productId: "product-a" });
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.equal(result.questions.length, 20); assert.equal(result.hasMore, true);
});

test("storage failure is unavailable, never a fabricated empty personal history", async () => {
  const service = new SupportHandoffService({} as never, {} as never,
    { supportTicketMessage: { findMany: async () => { throw Error("PRIVATE_STORAGE_DETAILS"); } } } as never);
  assert.deepEqual(await service.listProductQuestions({ merchantId: "merchant-a", buyerId: "buyer-a", productId: "product-a" }), { available: false });
});

test("a first linked question binds its receipt to the persisted message and protocol", async () => {
  let ticket: any, message: any;
  let creations = 0;
  const tx = { $queryRaw: async () => [],
    supportTicket: { findFirst: async () => null, create: async ({ data }: any) => { ticket = data; return data; }, update: async () => ticket },
    supportTicketMessage: { findFirst: async () => null, create: async ({ data }: any) => { message = data; return data; } },
    outboxMessage: { upsert: async ({ create }: any) => create } };
  const service = new SupportHandoffService({} as never, { publishCreated: () => { creations++; } } as never,
    { $transaction: async (work: any) => work(tx) } as never);
  const result = await service.createHandoff({ merchantId: "merchant-a", sessionId: "conversation-a", buyerId: "buyer-a",
    buyerMessage: "Pergunta sobre Produto: Pergunta própria?", initialMessage: "Pergunta sobre Produto: Pergunta própria?",
    productQuestion: { productId: "product-a", questionText: "Pergunta própria?" } });
  assert.equal(result.ticketId, ticket.id);
  assert.equal(result.questionMessageId, message.id);
  assert.equal(message.ticketId, ticket.id);
  assert.equal(message.senderType, "buyer");
  assert.equal(message.content, "Pergunta sobre Produto: Pergunta própria?");
  assert.deepEqual(message.metadata, { ...metadata(message.id), ticketId: ticket.id });
  assert.equal(creations, 1);
});

test("a free-text legacy question cannot become a linked personal receipt merely by matching its words", async () => {
  const now = new Date();
  const ticket = { id: "owned-ticket", merchantId: "merchant-a", sessionId: "conversation-a", buyerId: "buyer-a",
    buyerMessage: "Pergunta sobre Produto: Pergunta própria?", status: "open", createdAt: now, updatedAt: now };
  const legacy = { id: "legacy", ticketId: ticket.id, content: ticket.buyerMessage, senderType: "buyer", createdAt: now, metadata: { kind: "text" } };
  const writes: any[] = [];
  const tx = { $queryRaw: async () => [],
    supportTicket: { findFirst: async () => ticket, update: async () => ticket, create: async () => assert.fail("must reuse owned ticket") },
    supportTicketMessage: { findFirst: async () => legacy,
      create: async ({ data }: any) => { writes.push(data); return data; } },
    outboxMessage: { upsert: async ({ create }: any) => create } };
  const service = new SupportHandoffService({} as never, { publishCreated: () => assert.fail("must not republish creation") } as never,
    { $transaction: async (work: any) => work(tx) } as never);
  const result = await service.createHandoff({ merchantId: "merchant-a", sessionId: "conversation-a", buyerId: "buyer-a",
    buyerMessage: ticket.buyerMessage, initialMessage: ticket.buyerMessage,
    productQuestion: { productId: "product-a", questionText: "Pergunta própria?" } });
  assert.equal(writes.length, 1);
  assert.notEqual(result.questionMessageId, legacy.id);
  assert.deepEqual(writes[0].metadata, metadata(result.questionMessageId!));
  assert.deepEqual(legacy.metadata, { kind: "text" });
});
