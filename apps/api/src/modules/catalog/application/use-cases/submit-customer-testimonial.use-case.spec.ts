import { describe, it, mock, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { SubmitCustomerTestimonialUseCase } from "./submit-customer-testimonial.use-case.js";
import type { ProductTestimonialRepositoryPort } from "../../domain/ports/product-testimonial-repository.port.js";
import { ProductTestimonialEntity } from "../../domain/entities/product-testimonial.entity.js";
import type { ProductContentMetricsService } from "../services/product-content-metrics.service.js";

const makeEntity = (overrides: Partial<{ id: string; rating: number | null; buyerId: string | null }> = {}) =>
  ProductTestimonialEntity.rehydrate({
    id: overrides.id ?? "t-1",
    productId: "p-1",
    authorName: "Ana",
    body: "Adorei!",
    rating: overrides.rating ?? null,
    source: "customer_submission",
    buyerId: overrides.buyerId ?? null,
    orderId: null,
    moderationStatus: "pending",
    isPublished: false,
    locale: "pt-BR",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

describe("SubmitCustomerTestimonialUseCase", () => {
  let testimonialRepo: ProductTestimonialRepositoryPort;
  let metrics: ProductContentMetricsService;
  let eventBus: { publish: ReturnType<typeof mock.fn> };
  let useCase: SubmitCustomerTestimonialUseCase;

  beforeEach(() => {
    testimonialRepo = {
      findApprovedByProduct: mock.fn(async () => []),
      listAllForMerchant: mock.fn(async () => []),
      create: mock.fn(async (_input: unknown, _actor: unknown) => makeEntity()),
      update: mock.fn(),
      delete: mock.fn(),
      approve: mock.fn(),
      reject: mock.fn(),
    };
    metrics = {
      recordTestimonialApproved: mock.fn(),
      recordTestimonialSubmitted: mock.fn(),
      recordVideoApproved: mock.fn(),
      recordVideoSubmitted: mock.fn(),
    } as unknown as ProductContentMetricsService;
    eventBus = { publish: mock.fn(async () => undefined) };
    useCase = new SubmitCustomerTestimonialUseCase(
      testimonialRepo as any,
      metrics,
      eventBus as any,
    );
  });

  it("creates a pending customer_submission testimonial", async () => {
    const created = await useCase.execute({
      merchantId: "m-1",
      productId: "p-1",
      authorName: "Ana",
      body: "Produto ótimo, recomendo!",
      rating: 5,
      buyerId: "buyer-1",
    });

    assert.equal(created.moderationStatus, "pending");
    assert.equal(created.isPublished, false);
    assert.equal((testimonialRepo.create as any).mock.callCount(), 1);

    const createArgs = (testimonialRepo.create as any).mock.calls[0].arguments;
    assert.equal(createArgs[0].merchantId, "m-1");
    assert.equal(createArgs[0].productId, "p-1");
    assert.equal(createArgs[0].source, "customer_submission");
    assert.equal(createArgs[0].moderationStatus, "pending");
    assert.equal(createArgs[0].isPublished, false);
    assert.equal(createArgs[0].buyerId, "buyer-1");
    assert.equal(createArgs[1].isBuyer, true);

    assert.equal((metrics.recordTestimonialSubmitted as any).mock.callCount(), 1);
    assert.equal((eventBus.publish as any).mock.callCount(), 1);
    const published = (eventBus.publish as any).mock.calls[0].arguments[0];
    assert.equal(published.eventType, "product.testimonial.submitted");
    assert.equal(published.merchantId, "m-1");
    assert.equal(published.payload.buyerId, "buyer-1");
  });

  it("rejects unsafe avatar URLs (javascript: scheme) before persistence", async () => {
    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m-1",
          productId: "p-1",
          authorName: "Ana",
          body: "ok",
          authorAvatarUrl: "javascript:alert(1)",
        }),
      /product_content_validator_url_unsafe_scheme/
    );
    assert.equal((testimonialRepo.create as any).mock.callCount(), 0);
  });

  it("rejects data: URLs in the avatar URL", async () => {
    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m-1",
          productId: "p-1",
          authorName: "Ana",
          body: "ok",
          authorAvatarUrl: "data:text/html,<script>alert(1)</script>",
        }),
      /product_content_validator_url_unsafe_scheme/
    );
    assert.equal((testimonialRepo.create as any).mock.callCount(), 0);
  });

  it("rate-limit semantics: rate limiter is a controller-layer concern; the use-case itself does not throttle", async () => {
    // The use-case must remain pure: the rate-limit guard runs at the HTTP
    // layer (RateLimitGuard via @RateLimit decorator). Verifying here that
    // the use-case does not silently swallow its own caller by, e.g.,
    // looking at a process-global counter.
    for (let i = 0; i < 3; i++) {
      await useCase.execute({
        merchantId: "m-1",
        productId: "p-1",
        authorName: `Author ${i}`,
        body: `body ${i}`,
      });
    }
    assert.equal((testimonialRepo.create as any).mock.callCount(), 3);
  });

  it("requires a non-empty authorName", async () => {
    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m-1",
          productId: "p-1",
          authorName: "   ",
          body: "ok",
        }),
      /product_testimonial_author_name_empty/
    );
  });

  it("rejects out-of-range ratings", async () => {
    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m-1",
          productId: "p-1",
          authorName: "Ana",
          body: "ok",
          rating: 6,
        }),
      /product_testimonial_rating_out_of_range/
    );
    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m-1",
          productId: "p-1",
          authorName: "Ana",
          body: "ok",
          rating: 0,
        }),
      /product_testimonial_rating_out_of_range/
    );
  });
});
