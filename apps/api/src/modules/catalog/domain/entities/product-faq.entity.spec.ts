import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProductFaqEntity } from "./product-faq.entity.js";

const baseProps = () => ({
  id: "faq_1",
  productId: "prd_1",
  question: "What is it?",
  answer: "It is a thing.",
  order: 0,
  isPublished: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

describe("ProductFaqEntity", () => {
  describe("rehydrate() — happy path", () => {
    it("creates a FAQ", () => {
      const e = ProductFaqEntity.rehydrate(baseProps());
      assert.strictEqual(e.id, "faq_1");
      assert.strictEqual(e.productId, "prd_1");
      assert.strictEqual(e.question, "What is it?");
      assert.strictEqual(e.answer, "It is a thing.");
      assert.strictEqual(e.isPublished, false);
      assert.strictEqual(e.order, 0);
    });

    it("accepts a published FAQ", () => {
      const e = ProductFaqEntity.rehydrate({ ...baseProps(), isPublished: true });
      assert.strictEqual(e.isPublished, true);
    });
  });

  describe("rehydrate() — invariants", () => {
    it("rejects empty id", () => {
      assert.throws(
        () => ProductFaqEntity.rehydrate({ ...baseProps(), id: "" }),
        /product_faq_id_required/,
      );
    });

    it("rejects empty productId", () => {
      assert.throws(
        () => ProductFaqEntity.rehydrate({ ...baseProps(), productId: "" }),
        /product_faq_product_id_required/,
      );
    });

    it("rejects empty question", () => {
      assert.throws(
        () => ProductFaqEntity.rehydrate({ ...baseProps(), question: "" }),
        /product_faq_question_empty/,
      );
    });

    it("rejects whitespace-only question", () => {
      assert.throws(
        () => ProductFaqEntity.rehydrate({ ...baseProps(), question: "   \t  " }),
        /product_faq_question_empty/,
      );
    });

    it("rejects empty answer", () => {
      assert.throws(
        () => ProductFaqEntity.rehydrate({ ...baseProps(), answer: "" }),
        /product_faq_answer_empty/,
      );
    });

    it("rejects non-string answer", () => {
      assert.throws(
        () => ProductFaqEntity.rehydrate({ ...baseProps(), answer: 123 as unknown as string }),
        /product_faq_answer_empty/,
      );
    });
  });

  describe("publish() / unpublish()", () => {
    it("toggles isPublished immutably", () => {
      const e0 = ProductFaqEntity.rehydrate(baseProps());
      const e1 = e0.publish();
      assert.strictEqual(e0.isPublished, false);
      assert.strictEqual(e1.isPublished, true);
      const e2 = e1.unpublish();
      assert.strictEqual(e1.isPublished, true);
      assert.strictEqual(e2.isPublished, false);
    });

    it("returns the same instance on no-op publish", () => {
      const e = ProductFaqEntity.rehydrate({ ...baseProps(), isPublished: true });
      assert.strictEqual(e.publish(), e);
    });
  });

  describe("edit()", () => {
    it("updates question, answer, order", () => {
      const e = ProductFaqEntity.rehydrate(baseProps());
      const u = e.edit({ question: "Why?", answer: "Because.", order: 2 });
      assert.strictEqual(u.question, "Why?");
      assert.strictEqual(u.answer, "Because.");
      assert.strictEqual(u.order, 2);
    });

    it("rejects empty question on edit", () => {
      const e = ProductFaqEntity.rehydrate(baseProps());
      assert.throws(() => e.edit({ question: "" }), /product_faq_question_empty/);
    });

    it("rejects empty answer on edit", () => {
      const e = ProductFaqEntity.rehydrate(baseProps());
      assert.throws(() => e.edit({ answer: "" }), /product_faq_answer_empty/);
    });
  });
});
