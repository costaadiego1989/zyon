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
  for (const filter of ["mine", "unanswered"] as const) {
    const result: any = await handlers.getProductQuestions({ productId: "product", filter });
    assert.equal(result.error, "product_question_history_unavailable");
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
