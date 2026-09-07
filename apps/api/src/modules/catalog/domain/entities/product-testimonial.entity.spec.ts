import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProductTestimonialEntity } from "./product-testimonial.entity.js";

const baseProps = () => ({
  id: "tst_1",
  productId: "prd_1",
  authorName: "Alice",
  body: "Great product, would buy again.",
  rating: 5,
  source: "curated" as const,
  moderationStatus: "approved" as const,
  isPublished: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

describe("ProductTestimonialEntity", () => {
  describe("rehydrate() — happy path", () => {
    it("creates a testimonial with rating", () => {
      const e = ProductTestimonialEntity.rehydrate(baseProps());
      assert.strictEqual(e.id, "tst_1");
      assert.strictEqual(e.authorName, "Alice");
      assert.strictEqual(e.rating, 5);
      assert.strictEqual(e.source, "curated");
      assert.strictEqual(e.moderationStatus, "approved");
      assert.strictEqual(e.isPublished, true);
    });

    it("creates a testimonial without rating", () => {
      const e = ProductTestimonialEntity.rehydrate({ ...baseProps(), rating: null });
      assert.strictEqual(e.rating, null);
    });

    it("creates a customer-submission testimonial with buyer link", () => {
      const e = ProductTestimonialEntity.rehydrate({
        ...baseProps(),
        source: "customer_submission",
        buyerId: "buyer_1",
        orderId: "ord_1",
        moderationStatus: "pending",
        isPublished: false,
      });
      assert.strictEqual(e.source, "customer_submission");
      assert.strictEqual(e.buyerId, "buyer_1");
      assert.strictEqual(e.orderId, "ord_1");
      assert.strictEqual(e.moderationStatus, "pending");
    });
  });

  describe("rehydrate() — invariants", () => {
    it("rejects empty body", () => {
      assert.throws(
        () => ProductTestimonialEntity.rehydrate({ ...baseProps(), body: "" }),
        /product_testimonial_body_empty/,
      );
    });

    it("rejects whitespace-only body", () => {
      assert.throws(
        () => ProductTestimonialEntity.rehydrate({ ...baseProps(), body: "  \n  " }),
        /product_testimonial_body_empty/,
      );
    });

    it("rejects rating below 1", () => {
      assert.throws(
        () => ProductTestimonialEntity.rehydrate({ ...baseProps(), rating: 0 }),
        /product_testimonial_rating_out_of_range/,
      );
    });

    it("rejects rating above 5", () => {
      assert.throws(
        () => ProductTestimonialEntity.rehydrate({ ...baseProps(), rating: 6 }),
        /product_testimonial_rating_out_of_range/,
      );
    });

    it("accepts rating boundaries 1 and 5", () => {
      const a = ProductTestimonialEntity.rehydrate({ ...baseProps(), rating: 1 });
      const b = ProductTestimonialEntity.rehydrate({ ...baseProps(), rating: 5 });
      assert.strictEqual(a.rating, 1);
      assert.strictEqual(b.rating, 5);
    });

    it("rejects unknown source", () => {
      assert.throws(
        () =>
          ProductTestimonialEntity.rehydrate({
            ...baseProps(),
            source: "scraped" as unknown as "curated",
          }),
        /product_testimonial_invalid_source/,
      );
    });

    it("rejects unknown moderation status", () => {
      assert.throws(
        () =>
          ProductTestimonialEntity.rehydrate({
            ...baseProps(),
            moderationStatus: "weird" as unknown as "approved",
          }),
        /product_testimonial_invalid_moderation_status/,
      );
    });
  });

  describe("approve() / reject()", () => {
    it("approve transitions moderation to approved", () => {
      const e = ProductTestimonialEntity.rehydrate({ ...baseProps(), moderationStatus: "pending" });
      const a = e.approve();
      assert.strictEqual(a.moderationStatus, "approved");
      assert.strictEqual(e.moderationStatus, "pending", "original is not mutated");
    });

    it("reject transitions moderation to rejected", () => {
      const e = ProductTestimonialEntity.rehydrate({ ...baseProps(), moderationStatus: "pending" });
      const r = e.reject();
      assert.strictEqual(r.moderationStatus, "rejected");
    });
  });

  describe("publish() / unpublish()", () => {
    it("publish requires approved status", () => {
      const e = ProductTestimonialEntity.rehydrate({ ...baseProps(), moderationStatus: "pending", isPublished: false });
      assert.throws(() => e.publish(), /product_testimonial_publish_requires_approval/);
    });

    it("publishes when approved", () => {
      const e = ProductTestimonialEntity.rehydrate({ ...baseProps(), isPublished: false });
      const p = e.publish();
      assert.strictEqual(p.isPublished, true);
    });

    it("unpublish is always allowed", () => {
      const e = ProductTestimonialEntity.rehydrate({ ...baseProps(), isPublished: true });
      const u = e.unpublish();
      assert.strictEqual(u.isPublished, false);
    });
  });

  describe("edit()", () => {
    it("updates body and rating", () => {
      const e = ProductTestimonialEntity.rehydrate(baseProps());
      const u = e.edit({ body: "Updated copy", rating: 4 });
      assert.strictEqual(u.body, "Updated copy");
      assert.strictEqual(u.rating, 4);
    });

    it("rejects empty body on edit", () => {
      const e = ProductTestimonialEntity.rehydrate(baseProps());
      assert.throws(() => e.edit({ body: "" }), /product_testimonial_body_empty/);
    });

    it("rejects rating out of range on edit", () => {
      const e = ProductTestimonialEntity.rehydrate(baseProps());
      assert.throws(() => e.edit({ rating: 7 }), /product_testimonial_rating_out_of_range/);
    });
  });
});
