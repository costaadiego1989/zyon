import { describe, it, mock, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { SubmitCustomerVideoUseCase } from "./submit-customer-video.use-case.js";
import type { ProductVideoRepositoryPort } from "../../domain/ports/product-video-repository.port.js";
import { ProductVideoEntity } from "../../domain/entities/product-video.entity.js";

const makeEntity = (overrides: Partial<{ id: string; buyerId: string | null }> = {}) =>
  ProductVideoEntity.rehydrate({
    id: overrides.id ?? "v-1",
    productId: "p-1",
    title: "Demo",
    videoUrl: "https://example.com/video.mp4",
    source: "customer",
    buyerId: overrides.buyerId ?? null,
    moderationStatus: "pending",
    isPublished: false,
    locale: "pt-BR",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

describe("SubmitCustomerVideoUseCase", () => {
  let videoRepo: ProductVideoRepositoryPort;
  let eventBus: { publish: ReturnType<typeof mock.fn> };
  let useCase: SubmitCustomerVideoUseCase;

  beforeEach(() => {
    videoRepo = {
      findApprovedByProduct: mock.fn(async () => []),
      listAllForMerchant: mock.fn(async () => []),
      create: mock.fn(async (_input: unknown, _actor: unknown) => makeEntity()),
      update: mock.fn(),
      delete: mock.fn(),
      approve: mock.fn(),
      reject: mock.fn(),
    };
    eventBus = { publish: mock.fn(async () => undefined) };
    useCase = new SubmitCustomerVideoUseCase(videoRepo as any, eventBus as any);
  });

  it("creates a pending customer video", async () => {
    const created = await useCase.execute({
      merchantId: "m-1",
      productId: "p-1",
      title: "Unboxing do produto",
      videoUrl: "https://youtube.com/watch?v=abc123",
      thumbnailUrl: "https://cdn.example.com/thumb.jpg",
      durationSeconds: 90,
      buyerId: "buyer-1",
    });

    assert.equal(created.moderationStatus, "pending");
    assert.equal(created.isPublished, false);

    const createArgs = (videoRepo.create as any).mock.calls[0].arguments;
    assert.equal(createArgs[0].merchantId, "m-1");
    assert.equal(createArgs[0].source, "customer");
    assert.equal(createArgs[0].moderationStatus, "pending");
    assert.equal(createArgs[0].buyerId, "buyer-1");
    assert.equal(createArgs[1].isBuyer, true);

    // Event publishes the buyer-submission event with a videoId discriminator.
    const published = (eventBus.publish as any).mock.calls[0].arguments[0];
    assert.equal(published.eventType, "product.testimonial.submitted");
    assert.equal(published.merchantId, "m-1");
    assert.equal(published.payload.videoId, "v-1");
  });

  it("rejects non-http video URLs (javascript: scheme)", async () => {
    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m-1",
          productId: "p-1",
          title: "X",
          videoUrl: "javascript:alert(1)",
        }),
      /product_content_validator_url_unsafe_scheme/
    );
    assert.equal((videoRepo.create as any).mock.callCount(), 0);
  });

  it("rejects vbscript: URLs in the thumbnailUrl", async () => {
    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m-1",
          productId: "p-1",
          title: "Demo",
          videoUrl: "https://example.com/video.mp4",
          thumbnailUrl: "vbscript:msgbox(1)",
        }),
      /product_content_validator_url_unsafe_scheme/
    );
  });

  it("rejects negative duration", async () => {
    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m-1",
          productId: "p-1",
          title: "Demo",
          videoUrl: "https://example.com/video.mp4",
          durationSeconds: -5,
        }),
      /product_video_invalid_duration/
    );
  });

  it("requires a non-empty title", async () => {
    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m-1",
          productId: "p-1",
          title: "  ",
          videoUrl: "https://example.com/video.mp4",
        }),
      /product_video_title_required/
    );
  });
});
