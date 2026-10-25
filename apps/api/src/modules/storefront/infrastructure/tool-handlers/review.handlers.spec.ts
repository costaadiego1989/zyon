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
