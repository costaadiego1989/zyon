import { describe, it, mock, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { GetProductContentUseCase } from "./get-product-content.use-case.js";
import type { ProductContentRepositoryPort } from "../../domain/ports/product-content-repository.port.js";
import type { ProductFaqRepositoryPort } from "../../domain/ports/product-faq-repository.port.js";
import type { ProductTestimonialRepositoryPort } from "../../domain/ports/product-testimonial-repository.port.js";
import type { ProductVideoRepositoryPort } from "../../domain/ports/product-video-repository.port.js";
import { ProductContentBlockEntity } from "../../domain/entities/product-content-block.entity.js";
import { ProductFaqEntity } from "../../domain/entities/product-faq.entity.js";
import { ProductTestimonialEntity } from "../../domain/entities/product-testimonial.entity.js";
import { ProductVideoEntity } from "../../domain/entities/product-video.entity.js";

const block = (overrides: Partial<{ id: string; isEnabled: boolean; order: number }> = {}) =>
  ProductContentBlockEntity.rehydrate({
    id: overrides.id ?? "b1",
    productId: "p1",
    type: "paragraph",
    props: { text: "hello" },
    order: overrides.order ?? 0,
    isEnabled: overrides.isEnabled ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

const faq = (overrides: Partial<{ id: string; isPublished: boolean }> = {}) =>
  ProductFaqEntity.rehydrate({
    id: overrides.id ?? "f1",
    productId: "p1",
    question: "Q?",
    answer: "A.",
    order: 0,
    isPublished: overrides.isPublished ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

const testimonial = (overrides: Partial<{ isPublished: boolean }> = {}) =>
  ProductTestimonialEntity.rehydrate({
    id: "t1",
    productId: "p1",
    authorName: "Ana",
    body: "Great.",
    source: "curated",
    moderationStatus: "approved",
    isPublished: overrides.isPublished ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

const video = (overrides: Partial<{ isPublished: boolean }> = {}) =>
  ProductVideoEntity.rehydrate({
    id: "v1",
    productId: "p1",
    title: "Demo",
    videoUrl: "https://example.com/video.mp4",
    source: "merchant",
    moderationStatus: "approved",
    isPublished: overrides.isPublished ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

describe("GetProductContentUseCase", () => {
  let contentRepo: ProductContentRepositoryPort;
  let faqRepo: ProductFaqRepositoryPort;
  let testimonialRepo: ProductTestimonialRepositoryPort;
  let videoRepo: ProductVideoRepositoryPort;

  beforeEach(() => {
    contentRepo = {
      findByProduct: mock.fn(async () => [block(), block({ id: "b2", isEnabled: false, order: 1 })]),
      upsert: mock.fn(),
      delete: mock.fn(),
      replaceAll: mock.fn(),
    };
    faqRepo = {
      findPublishedByProduct: mock.fn(async () => [faq()]),
      listAllForMerchant: mock.fn(),
      create: mock.fn(),
      update: mock.fn(),
      delete: mock.fn(),
      reorder: mock.fn(),
    };
    testimonialRepo = {
      findApprovedByProduct: mock.fn(async () => [testimonial()]),
      listAllForMerchant: mock.fn(),
      create: mock.fn(),
      update: mock.fn(),
      delete: mock.fn(),
      approve: mock.fn(),
      reject: mock.fn(),
    };
    videoRepo = {
      findApprovedByProduct: mock.fn(async () => [video()]),
      listAllForMerchant: mock.fn(),
      create: mock.fn(),
      update: mock.fn(),
      delete: mock.fn(),
      approve: mock.fn(),
      reject: mock.fn(),
    };
  });

  it("aggregates blocks, faqs, testimonials, videos", async () => {
    const useCase = new GetProductContentUseCase(
      contentRepo,
      faqRepo,
      testimonialRepo,
      videoRepo,
    );
    const result = await useCase.execute({ merchantId: "m1", productId: "p1" });
    assert.equal(result.blocks.length, 1); // disabled filtered out
    assert.equal(result.blocks[0].id, "b1");
    assert.equal(result.faqs.length, 1);
    assert.equal(result.testimonials.length, 1);
    assert.equal(result.videos.length, 1);
  });

  it("filters disabled blocks", async () => {
    contentRepo = {
      ...contentRepo,
      findByProduct: mock.fn(async () => [
        block({ id: "x", isEnabled: false }),
        block({ id: "y", isEnabled: true }),
      ]),
    };
    const useCase = new GetProductContentUseCase(
      contentRepo,
      faqRepo,
      testimonialRepo,
      videoRepo,
    );
    const result = await useCase.execute({ merchantId: "m1", productId: "p1" });
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0].id, "y");
  });

  it("passes merchantId to all repos for tenant scoping", async () => {
    const useCase = new GetProductContentUseCase(
      contentRepo,
      faqRepo,
      testimonialRepo,
      videoRepo,
    );
    await useCase.execute({ merchantId: "m1", productId: "p1" });
    assert.equal((contentRepo.findByProduct as any).mock.callCount(), 1);
    assert.equal((contentRepo.findByProduct as any).mock.calls[0].arguments[0].merchantId, "m1");
  });
});
