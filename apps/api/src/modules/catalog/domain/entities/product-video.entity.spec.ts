import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProductVideoEntity } from "./product-video.entity.js";

const baseProps = () => ({
  id: "vid_1",
  productId: "prd_1",
  title: "Unboxing",
  videoUrl: "https://cdn.example.com/vid.mp4",
  thumbnailUrl: "https://cdn.example.com/thumb.jpg",
  durationSeconds: 120,
  source: "merchant" as const,
  moderationStatus: "approved" as const,
  isPublished: true,
  locale: "pt-BR",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

describe("ProductVideoEntity", () => {
  describe("rehydrate() — happy path", () => {
    it("creates a merchant video", () => {
      const e = ProductVideoEntity.rehydrate(baseProps());
      assert.strictEqual(e.id, "vid_1");
      assert.strictEqual(e.title, "Unboxing");
      assert.strictEqual(e.videoUrl, "https://cdn.example.com/vid.mp4");
      assert.strictEqual(e.thumbnailUrl, "https://cdn.example.com/thumb.jpg");
      assert.strictEqual(e.durationSeconds, 120);
      assert.strictEqual(e.source, "merchant");
      assert.strictEqual(e.moderationStatus, "approved");
      assert.strictEqual(e.isPublished, true);
    });

    it("creates a customer-submitted video (pending by default)", () => {
      const e = ProductVideoEntity.rehydrate({
        ...baseProps(),
        source: "customer",
        buyerId: "buyer_1",
        moderationStatus: "pending",
        isPublished: false,
      });
      assert.strictEqual(e.source, "customer");
      assert.strictEqual(e.buyerId, "buyer_1");
      assert.strictEqual(e.moderationStatus, "pending");
    });

    it("accepts a video with no thumbnail or duration", () => {
      const e = ProductVideoEntity.rehydrate({
        ...baseProps(),
        thumbnailUrl: undefined,
        durationSeconds: undefined,
      });
      // The disk entity stores the raw value as-is (undefined stays undefined).
      assert.ok(e.thumbnailUrl === undefined || e.thumbnailUrl === null);
      assert.ok(e.durationSeconds === undefined || e.durationSeconds === null);
    });
  });

  describe("rehydrate() — invariants", () => {
    it("rejects empty title", () => {
      assert.throws(
        () => ProductVideoEntity.rehydrate({ ...baseProps(), title: "" }),
        /product_video_title/,
      );
    });

    it("rejects whitespace-only title", () => {
      assert.throws(
        () => ProductVideoEntity.rehydrate({ ...baseProps(), title: "   " }),
        /product_video_title/,
      );
    });

    it("rejects empty videoUrl", () => {
      assert.throws(
        () => ProductVideoEntity.rehydrate({ ...baseProps(), videoUrl: "" }),
        /product_video_url/,
      );
    });

    it("rejects negative duration", () => {
      assert.throws(
        () => ProductVideoEntity.rehydrate({ ...baseProps(), durationSeconds: -1 }),
        /product_video_invalid_duration/,
      );
    });

    it("rejects non-finite duration", () => {
      assert.throws(
        () =>
          ProductVideoEntity.rehydrate({
            ...baseProps(),
            durationSeconds: Number.POSITIVE_INFINITY,
          }),
        /product_video_invalid_duration/,
      );
    });

    it("rejects unknown source", () => {
      assert.throws(
        () =>
          ProductVideoEntity.rehydrate({
            ...baseProps(),
            source: "scraped" as unknown as "merchant",
          }),
        /product_video_invalid_source/,
      );
    });

    it("rejects unknown moderation status", () => {
      assert.throws(
        () =>
          ProductVideoEntity.rehydrate({
            ...baseProps(),
            moderationStatus: "weird" as unknown as "approved",
          }),
        /product_video_invalid_moderation_status/,
      );
    });
  });

  describe("approve() / reject()", () => {
    it("approve sets status to approved", () => {
      const e = ProductVideoEntity.rehydrate({ ...baseProps(), moderationStatus: "pending" });
      const a = e.approve();
      assert.strictEqual(a.moderationStatus, "approved");
      assert.strictEqual(e.moderationStatus, "pending", "original is not mutated");
    });

    it("reject sets status to rejected", () => {
      const e = ProductVideoEntity.rehydrate({ ...baseProps(), moderationStatus: "pending" });
      const r = e.reject();
      assert.strictEqual(r.moderationStatus, "rejected");
    });
  });

  describe("publish() / unpublish()", () => {
    it("publishes (no approval gate on disk entity)", () => {
      const e = ProductVideoEntity.rehydrate({
        ...baseProps(),
        moderationStatus: "pending",
        isPublished: false,
      });
      const p = e.publish();
      assert.strictEqual(p.isPublished, true);
    });

    it("publishes when approved", () => {
      const e = ProductVideoEntity.rehydrate({ ...baseProps(), isPublished: false });
      const p = e.publish();
      assert.strictEqual(p.isPublished, true);
    });

    it("unpublish toggles back to false", () => {
      const e = ProductVideoEntity.rehydrate({ ...baseProps(), isPublished: true });
      const u = e.unpublish();
      assert.strictEqual(u.isPublished, false);
    });
  });

  describe("rehydrate() rejects negative duration on bad input", () => {
    it("rejects when rehydrating with negative duration", () => {
      assert.throws(
        () =>
          ProductVideoEntity.rehydrate({
            ...baseProps(),
            durationSeconds: -5,
          }),
        /product_video_duration_negative|product_video_invalid_duration/,
      );
    });

    it("rejects when rehydrating with empty title", () => {
      assert.throws(
        () => ProductVideoEntity.rehydrate({ ...baseProps(), title: "" }),
        /product_video_title_required|product_video_title_empty/,
      );
    });

    it("rejects when rehydrating with empty videoUrl", () => {
      assert.throws(
        () => ProductVideoEntity.rehydrate({ ...baseProps(), videoUrl: "" }),
        /product_video_url_required|product_video_url_empty/,
      );
    });
  });
});
