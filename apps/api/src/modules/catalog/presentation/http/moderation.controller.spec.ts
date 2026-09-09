import { describe, it, mock, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { ModerationController } from "./moderation.controller.js";
import type { ProductTestimonialRepositoryPort } from "../../domain/ports/product-testimonial-repository.port.js";
import type { ProductVideoRepositoryPort } from "../../domain/ports/product-video-repository.port.js";
import { ProductTestimonialEntity } from "../../domain/entities/product-testimonial.entity.js";
import { ProductVideoEntity } from "../../domain/entities/product-video.entity.js";
import type { PrismaClient } from "@prisma/client";
import { NotFoundException } from "@nestjs/common";

const tEntity = (id: string, overrides: Partial<{ moderationStatus: "pending" | "approved" | "rejected" }> = {}) =>
  ProductTestimonialEntity.rehydrate({
    id,
    productId: "p-1",
    authorName: `Author ${id}`,
    body: `Body ${id}`,
    source: "customer_submission",
    buyerId: null,
    orderId: null,
    rating: null,
    moderationStatus: overrides.moderationStatus ?? "pending",
    isPublished: false,
    locale: "pt-BR",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

const vEntity = (id: string) =>
  ProductVideoEntity.rehydrate({
    id,
    productId: "p-1",
    title: `Video ${id}`,
    videoUrl: `https://example.com/${id}.mp4`,
    source: "customer",
    thumbnailUrl: null,
    durationSeconds: null,
    buyerId: null,
    orderId: null,
    moderationStatus: "pending",
    isPublished: false,
    locale: "pt-BR",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

describe("ModerationController", () => {
  let testimonialRepo: ProductTestimonialRepositoryPort;
  let videoRepo: ProductVideoRepositoryPort;
  let moderateTestimonial: { approve: ReturnType<typeof mock.fn>; reject: ReturnType<typeof mock.fn> };
  let moderateVideo: { approve: ReturnType<typeof mock.fn>; reject: ReturnType<typeof mock.fn> };
  let listMerchantReviews: { execute: ReturnType<typeof mock.fn> };
  let prisma: { product: { findFirst: ReturnType<typeof mock.fn> } };
  let controller: ModerationController;

  beforeEach(() => {
    testimonialRepo = {
      findApprovedByProduct: mock.fn(async () => []),
      listAllForMerchant: mock.fn(async () => [tEntity("t-1"), tEntity("t-2")]),
      create: mock.fn(),
      update: mock.fn(),
      delete: mock.fn(),
      approve: mock.fn(),
      reject: mock.fn(),
    };
    videoRepo = {
      findApprovedByProduct: mock.fn(async () => []),
      listAllForMerchant: mock.fn(async () => [vEntity("v-1")]),
      create: mock.fn(),
      update: mock.fn(),
      delete: mock.fn(),
      approve: mock.fn(),
      reject: mock.fn(),
    };
    moderateTestimonial = {
      approve: mock.fn(async (input: { id: string }) => tEntity(input.id, { moderationStatus: "approved" })),
      reject: mock.fn(async (input: { id: string }) => tEntity(input.id, { moderationStatus: "rejected" })),
    };
    moderateVideo = {
      approve: mock.fn(async (input: { id: string }) => vEntity(input.id)),
      reject: mock.fn(async (input: { id: string }) => vEntity(input.id)),
    };
    listMerchantReviews = {
      execute: mock.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0 })),
    };
    prisma = {
      product: {
        findFirst: mock.fn(async ({ where }: { where: { id: string; merchantId: string } }) => ({
          id: where.id,
          merchantId: where.merchantId,
        })),
      },
    };
    controller = new ModerationController(
      prisma as unknown as PrismaClient,
      testimonialRepo as any,
      videoRepo as any,
      moderateTestimonial as any,
      moderateVideo as any,
      listMerchantReviews as any,
    );
  });

  it("lists pending testimonials and videos for a merchant+product", async () => {
    const out = await controller.listPending("m-1", "p-1");
    assert.equal(out.pendingTestimonials.length, 2);
    assert.equal(out.pendingVideos.length, 1);
    assert.equal(out.pendingTestimonials[0].moderationStatus, "pending");
    assert.equal(out.pendingVideos[0].moderationStatus, "pending");
    const tArgs = (testimonialRepo.listAllForMerchant as any).mock.calls[0].arguments[0];
    assert.equal(tArgs.merchantId, "m-1");
    assert.equal(tArgs.productId, "p-1");
    assert.equal(tArgs.moderationStatus, "pending");
  });

  it("passes review filters to the tenant-scoped list use case", async () => {
    const out = await controller.listMerchantReviewsRoute("m-1", {
      kind: "video",
      moderationStatus: "pending",
      productId: "p-1",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-08",
      page: "2",
      pageSize: "10",
    });
    assert.equal(out.page, 1);
    const args = (listMerchantReviews.execute as any).mock.calls[0].arguments[0];
    assert.equal(args.merchantId, "m-1");
    assert.equal(args.kind, "video");
    assert.equal(args.moderationStatus, "pending");
    assert.equal(args.productId, "p-1");
    assert.equal(args.page, 2);
    assert.equal(args.pageSize, 10);
    assert.equal(args.createdFrom.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(args.createdTo.toISOString(), "2026-09-08T23:59:59.999Z");
  });

  it("returns 404 when the product does not belong to the merchant", async () => {
    prisma.product.findFirst = mock.fn(async () => null);
    await assert.rejects(
      () => controller.listPending("m-1", "p-other"),
      (err: unknown) => err instanceof NotFoundException
    );
    assert.equal((testimonialRepo.listAllForMerchant as any).mock.callCount(), 0);
  });

  it("approves a testimonial on POST /moderate", async () => {
    const out = await controller.moderateTestimonialRoute(
      "m-1",
      "p-1",
      "t-1",
      { moderationStatus: "approved" },
      { user: { userId: "u-1" } } as any,
    );
    assert.equal((moderateTestimonial.approve as any).mock.callCount(), 1);
    assert.equal((moderateTestimonial.reject as any).mock.callCount(), 0);
    assert.equal(out.moderationStatus, "approved");
  });

  it("rejects a testimonial on POST /moderate with status=rejected", async () => {
    await controller.moderateTestimonialRoute(
      "m-1",
      "p-1",
      "t-1",
      { moderationStatus: "rejected" },
      { user: { userId: "u-1" } } as any,
    );
    assert.equal((moderateTestimonial.approve as any).mock.callCount(), 0);
    assert.equal((moderateTestimonial.reject as any).mock.callCount(), 1);
  });

  it("rejects unknown moderation status", async () => {
    await assert.rejects(
      () =>
        controller.moderateTestimonialRoute(
          "m-1",
          "p-1",
          "t-1",
          { moderationStatus: "spam" },
          { user: { userId: "u-1" } } as any,
        ),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        return "getStatus" in err && typeof (err as { getStatus?: unknown }).getStatus === "function"
          ? (err as { getStatus: () => number }).getStatus() === 400
          : false;
      }
    );
  });

  it("approves a video on POST /moderate", async () => {
    await controller.moderateVideoRoute(
      "m-1",
      "p-1",
      "v-1",
      { moderationStatus: "approved" },
      { user: { userId: "u-1" } } as any,
    );
    assert.equal((moderateVideo.approve as any).mock.callCount(), 1);
  });
});
