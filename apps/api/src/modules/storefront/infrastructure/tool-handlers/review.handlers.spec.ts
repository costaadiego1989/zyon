import test from "node:test";
import assert from "node:assert/strict";
import { createReviewHandlers } from "./review.handlers.js";
import { validateStorefrontToolOutput } from "../../domain/contracts/storefront-tool-output.schemas.js";

test("reviews use the moderated persistence service and the authenticated author, not a fabricated receipt", async () => {
  let written: any;
  const handlers = createReviewHandlers({ prisma: {} as any, submitTestimonial: { execute: async (input: any) => { written = input; return { id: "persisted-review" }; } } as any },
    { merchantId: "merchant", sessionId: "cart", buyer: { globalUserId: "verified-buyer", name: "Comprador" } });
  const result: any = await handlers.createReview({ productId: "product", rating: 5, text: "Muito bom", authorName: "Comprador", authorPhone: "forged" });
  assert.equal(result.id, "persisted-review"); assert.equal(result.status, "pending_moderation");
  assert.equal(written.buyerId, "verified-buyer"); assert.equal(written.merchantId, "merchant"); assert.equal(written.authorPhone, undefined);
  assert.equal(validateStorefrontToolOutput("create_review", result).ok, true);
});
test("product questions expose only published merchant FAQs and persist a real support handoff", async () => {
  let scoped: any, handoff: any;
  const handlers = createReviewHandlers({ prisma: { productFaq: { findMany: async (input: any) => { scoped = input; return [{ id: "real-faq", question: "Pergunta real", answer: "Resposta cadastrada" }]; } },
    product: { findFirst: async () => ({ name: "Produto" }) } } as any,
    supportHandoff: { createHandoff: async (input: any) => { handoff = input; return { ticketId: "real-ticket" }; } } as any }, { merchantId: "merchant", sessionId: "cart", conversationId: "conversation" });
  const questions: any = await handlers.getProductQuestions({ productId: "product" });
  assert.equal(questions.questions[0].id, "real-faq"); assert.equal(scoped.where.product.merchantId, "merchant"); assert.equal(scoped.where.isPublished, true);
  const result: any = await handlers.createQuestion({ productId: "product", question: "Qual é o prazo?", authorName: "Comprador" });
  assert.equal(result.id, "real-ticket"); assert.equal(handoff.sessionId, "conversation");
  assert.equal(validateStorefrontToolOutput("get_product_questions", questions).ok, true);
  assert.equal(validateStorefrontToolOutput("create_question", result).ok, true);
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
