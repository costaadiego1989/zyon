import test from "node:test";
import assert from "node:assert/strict";
import { createReviewHandlers } from "./review.handlers.js";
import { validateStorefrontToolOutput } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { SupportHandoffService } from "../../../support/application/support-handoff.service.js";

test("reviews use the moderated persistence service and the authenticated author, not a fabricated receipt", async () => {
  let written: any;
  const handlers = createReviewHandlers({ prisma: {} as any, submitTestimonial: { execute: async (input: any) => { written = input; return { id: "persisted-review", productId: input.productId }; } } as any },
    { merchantId: "merchant", sessionId: "cart", buyer: { globalUserId: "verified-buyer", name: "Comprador" } });
  const result: any = await handlers.createReview({ productId: "product", rating: 5, text: "Muito bom", authorName: "Comprador", authorPhone: "forged" });
  assert.equal(result.id, "persisted-review"); assert.equal(result.status, "pending_moderation");
  assert.equal(written.buyerId, "verified-buyer"); assert.equal(written.merchantId, "merchant"); assert.equal(written.authorPhone, undefined);
  assert.equal(validateStorefrontToolOutput("create_review", result).ok, true);
});

test("the submission reference comes from the persisted review", async () => {
  const handlers = createReviewHandlers({ prisma: {} as any,
    submitTestimonial: { execute: async () => ({ id: "persisted-review", productId: "persisted-product" }) } as any },
    { merchantId: "merchant", sessionId: "cart", buyer: { globalUserId: "buyer", name: "Comprador" } });
  const result: any = await handlers.createReview({ productId: "requested-product", rating: 3, text: "Avaliação" });
  assert.equal(result.productId, "persisted-product");
  assert.equal(result.status, "pending_moderation");
});
test("product questions expose only published merchant FAQs and persist a real support handoff", async () => {
  let scoped: any, handoff: any;
  const handlers = createReviewHandlers({ prisma: { productFaq: { findMany: async (input: any) => { scoped = input; return [{ id: "real-faq", question: "Pergunta real", answer: "Resposta cadastrada" }]; } },
    product: { findFirst: async () => ({ id: "product", name: "Produto" }) } } as any,
    supportHandoff: { createHandoff: async (input: any) => { handoff = input; return { ticketId: "real-ticket" }; } } as any }, { merchantId: "merchant", sessionId: "cart", conversationId: "conversation" });
  const questions: any = await handlers.getProductQuestions({ productId: "product" });
  assert.equal(questions.questions[0].id, "real-faq"); assert.equal(scoped.where.product.merchantId, "merchant"); assert.equal(scoped.where.isPublished, true);
  const result: any = await handlers.createQuestion({ productId: "product", question: "Qual é o prazo?", authorName: "Comprador" });
  assert.equal(result.id, "real-ticket"); assert.equal(handoff.sessionId, "conversation");
  assert.equal(handoff.initialMessage, "Pergunta sobre Produto: Qual é o prazo?");
  assert.equal(validateStorefrontToolOutput("get_product_questions", questions).ok, true);
  assert.equal(validateStorefrontToolOutput("create_question", result).ok, true);
});

test("public FAQs cannot be substituted for personal or unanswered questions", async () => {
  let reads = 0;
  const handlers = createReviewHandlers({ prisma: { product: { findFirst: async () => ({ id: "product", name: "Produto" }) },
    productFaq: { findMany: async () => { reads++; assert.fail("private filters must not query public FAQs"); } } } as never },
    { merchantId: "merchant", sessionId: "conversation", buyer: { globalUserId: "buyer" } });
  for (const [filter, error] of [["mine", "product_question_history_unavailable"], ["unanswered", "product_question_answer_link_unavailable"]] as const) {
    const result: any = await handlers.getProductQuestions({ productId: "product", filter });
    assert.equal(result.error, error);
    assert.equal(validateStorefrontToolOutput("get_product_questions", result).ok, true);
  }
  assert.equal(reads, 0);
});

test("a second product question is retained once when the authenticated buyer reuses an open case", async () => {
  const now = new Date();
  const ticket = { id: "owned-ticket", merchantId: "merchant", sessionId: "conversation", buyerId: "buyer", buyerMessage: "Atendimento anterior", status: "open", createdAt: now, updatedAt: now };
  const messages: any[] = [{ id: "initial", ticketId: ticket.id, content: "Atendimento anterior", senderType: "buyer", createdAt: now }];
  const events: any[] = [];
  const tx = { $queryRaw: async () => [],
    supportTicket: { findFirst: async ({ where }: any) => { assert.equal(where.merchantId, "merchant");
      assert.deepEqual(where.OR, [{ buyerId: "buyer" }, { sessionId: "conversation", buyerId: null }]); return ticket; },
      create: async () => assert.fail("must reuse the existing case"), update: async () => ticket },
    supportTicketMessage: { findFirst: async ({ where, orderBy }: any) => messages.filter(m => m.ticketId === where.ticketId && (!where.content || m.content === where.content)).at(orderBy ? -1 : 0) ?? null,
      create: async ({ data }: any) => { const row = { id: `message-${messages.length}`, ...data }; messages.push(row); return row; } },
    outboxMessage: { upsert: async ({ create }: any) => { events.push(create); return create; } } };
  const supportHandoff = new SupportHandoffService({} as never, { publishCreated: () => assert.fail("must not republish case creation") } as never,
    { $transaction: async (work: any) => work(tx) } as never);
  const handlers = createReviewHandlers({ prisma: { product: { findFirst: async () => ({ id: "product", name: "Produto" }) } } as never, supportHandoff },
    { merchantId: "merchant", sessionId: "conversation", conversationId: "conversation", buyer: { globalUserId: "buyer", name: "Conta real" } });
  for (const question of ["Primeira pergunta?", "Segunda pergunta?", "Segunda pergunta?"]) {
    const result: any = await handlers.createQuestion({ productId: "product", question, authorName: "Nome não comprova identidade" });
    assert.equal(result.id, ticket.id); assert.equal(result.author, "Conta real");
  }
  assert.equal(messages.length, 3);
  assert.equal(messages.filter(m => m.content === "Pergunta sobre Produto: Segunda pergunta?").length, 1);
  assert.equal(events.length, 2);
  const stored = messages.slice(1);
  for (const message of stored) {
    assert.equal(message.metadata.kind, "product_question");
    assert.equal(message.metadata.merchantId, "merchant");
    assert.equal(message.metadata.ticketId, ticket.id);
    assert.equal(message.metadata.buyerId, "buyer");
    assert.equal(message.metadata.productId, "product");
    assert.equal(message.metadata.sessionId, "conversation");
    assert.equal(message.metadata.questionMessageId, message.id);
  }
});

test("personal question history requires canonical identity and never queries public FAQs", async () => {
  const queries: any[] = [];
  const prisma = { product: { findFirst: async () => ({ id: "product", name: "Produto" }) },
    productFaq: { findMany: async () => assert.fail("mine must not read the public FAQ feed") } } as never;
  const history = { available: true, hasMore: false, questions: [{ id: "message", ticketId: "ticket", question: "Pergunta privada?", date: "2026-10-29T12:00:00Z", answerState: "not_linked" }] };
  const supportHandoff = { listProductQuestions: async (input: any) => { queries.push(input); return history; } } as never;
  const anonymous = createReviewHandlers({ prisma, supportHandoff }, { merchantId: "merchant", sessionId: "conversation" });
  const denied: any = await anonymous.getProductQuestions({ productId: "product", filter: "mine" });
  assert.equal(denied.error, "buyer_identity_required"); assert.equal(queries.length, 0);
  const own = createReviewHandlers({ prisma, supportHandoff }, { merchantId: "merchant", sessionId: "conversation", buyer: { globalUserId: "owner", name: "Nome repetido" } });
  const result: any = await own.getProductQuestions({ productId: "product", filter: "mine" });
  assert.deepEqual(queries, [{ merchantId: "merchant", buyerId: "owner", productId: "product" }]);
  assert.equal(result.scope, "buyer_history"); assert.equal(result.historyLimited, true);
  assert.equal(result.questions[0].answer, undefined);
  assert.equal(validateStorefrontToolOutput("get_product_questions", result).ok, true);
  assert.equal(validateStorefrontToolOutput("get_product_questions", { ...result,
    questions: [{ ...result.questions[0], answer: "Resposta genérica da loja" }] }).ok, false);
});

test("foreign or inactive products cannot disclose questions or create a buyer question", async () => {
  const handlers = createReviewHandlers({ prisma: { product: { findFirst: async ({ where }: any) => {
    assert.deepEqual(where, { id: "foreign-product", merchantId: "merchant", isActive: true }); return null; } },
    productFaq: { findMany: async () => assert.fail("must not read foreign FAQs") } } as never,
    supportHandoff: { listProductQuestions: async () => assert.fail("must not read foreign history"),
      createHandoff: async () => assert.fail("must not create a question about a foreign product") } as never },
    { merchantId: "merchant", sessionId: "conversation", buyer: { globalUserId: "buyer" } });
  for (const filter of ["answered", "mine", "unanswered"]) {
    assert.deepEqual(await handlers.getProductQuestions({ productId: "foreign-product", filter }), { error: "product_not_found" });
  }
  assert.deepEqual(await handlers.createQuestion({ productId: "foreign-product", question: "Pergunta?", authorName: "Mesmo nome" }), { error: "product_not_found" });
});

test("review reads preserve canonical aggregate, filtered page and source-aware cursor", async () => {
  let query: any;
  const review = { id: "testimonial:public-id", author: "Autor publicado", rating: 4, text: "Comentário publicado", date: "2026-10-29" };
  const handlers = createReviewHandlers({ prisma: {
    product: { findFirst: async () => ({ name: "Produto da loja" }) },
    $queryRaw: async (input: any) => { query = input; return [{ totalCount: 3, averageRating: 4.3, cursorValid: true,
      reviews: [review, { ...review, id: "review:legacy-id", rating: 5 }] }]; },
  } as any }, { merchantId: "own-merchant", sessionId: "conversation" });
  const result: any = await handlers.getReviews({ productId: "own-product", filter: "positive", limit: 1 });
  assert.equal(result.productName, "Produto da loja"); assert.equal(result.totalCount, 3);
  assert.equal(result.averageRating, 4.3); assert.deepEqual(result.reviews, [review]);
  assert.equal(result.nextCursor, review.id);
  assert(query.values.includes("own-merchant") && query.values.includes("own-product"));
  assert.equal(validateStorefrontToolOutput("get_reviews", result).ok, true);
});

test("a product outside the current merchant cannot disclose reviews or run the reader", async () => {
  const handlers = createReviewHandlers({ prisma: { product: { findFirst: async () => null },
    $queryRaw: async () => assert.fail("foreign product must not query reviews") } as any },
    { merchantId: "own-merchant", sessionId: "conversation" });
  assert.equal((await handlers.getReviews({ productId: "foreign-product" }) as any).error, "product_not_found");
});

test("review storage failures are reported as unavailable instead of a false empty catalogue", async () => {
  const handlers = createReviewHandlers({ prisma: { product: { findFirst: async () => ({ name: "Produto" }) },
    $queryRaw: async () => { throw new Error("PRIVATE_DATABASE_DETAILS"); } } as any },
    { merchantId: "own-merchant", sessionId: "conversation" });
  const result = await handlers.getReviews({ productId: "own-product" });
  assert.deepEqual(result, { error: "reviews_unavailable" });
});
