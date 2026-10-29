import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CancelQuoteJobUseCase } from "./cancel-quote-job.use-case.js";
import { RequestPriceQuoteUseCase } from "./request-price-quote.use-case.js";
import { IngestQuoteFromSourceUseCase } from "./ingest-quote-from-source.use-case.js";
import { PriceQuoteJobEntity } from "../../domain/entities/price-quote-job.entity.js";
import { InMemoryPriceQuoteJobRepository } from "../../infrastructure/repositories/in-memory-price-quote-job.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { PriceQuoteResult } from "../../domain/entities/price-quote-job.entity.js";

function makeSetup() {
  const repo = new InMemoryPriceQuoteJobRepository();
  const outbox = new InMemoryOutboxRepository();
  const requestQuote = new RequestPriceQuoteUseCase(repo, outbox);
  const ingestQuote = new IngestQuoteFromSourceUseCase(repo);
  const cancelJob = new CancelQuoteJobUseCase(repo);
  return { repo, outbox, requestQuote, ingestQuote, cancelJob };
}

const BASE_INPUT = {
  session_id: "sess_1",
  merchant_id: "mrc_1",
  raw_query: "iPhone 15 Pro 256GB",
};

function makeResult(overrides?: Partial<PriceQuoteResult>): PriceQuoteResult {
  return {
    id: `res_${Math.random().toString(36).slice(2)}`,
    source_key: "flat-rate",
    product_title: "iPhone 15 Pro 256GB",
    url: "https://shop.merchant.com/iphone15",
    price: 8990,
    shipping_estimate: 0,
    total_cost: 8990,
    currency: "BRL",
    availability: "in_stock",
    raw_snapshot: {},
    ingested_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("CancelQuoteJobUseCase", () => {
  it("cancels a pending job and persists the cancelled status", async () => {
    const { repo, requestQuote, cancelJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);

    const cancelled = await cancelJob.execute({ job_id: job.id, merchant_id: "mrc_1" });

    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.completed_at, "completed_at must be set on cancel");

    const persisted = await repo.findById(job.id, "mrc_1");
    assert.ok(persisted, "cancelled job must be persisted");
    assert.equal(persisted!.status, "cancelled");
  });

  it("cancels a running job", async () => {
    const { requestQuote, ingestQuote, cancelJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);
    await ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result: makeResult() });

    const cancelled = await cancelJob.execute({ job_id: job.id, merchant_id: "mrc_1" });

    assert.equal(cancelled.status, "cancelled");
  });

  it("throws NotFoundException when job_id does not exist", async () => {
    const { cancelJob } = makeSetup();
    await assert.rejects(
      () => cancelJob.execute({ job_id: "missing-job", merchant_id: "mrc_1" }),
      { message: "price_quote_job_not_found" }
    );
  });

  it("throws NotFoundException when merchant_id does not match (tenant boundary)", async () => {
    const { requestQuote, cancelJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT); // merchant_id = "mrc_1"

    await assert.rejects(
      () => cancelJob.execute({ job_id: job.id, merchant_id: "mrc_other" }),
      { message: "price_quote_job_not_found" }
    );
  });

  it("propagates illegal_transition when cancelling a completed job", async () => {
    // Build a fresh repo, write a job directly as "completed", then try to cancel it.
    const repo = new InMemoryPriceQuoteJobRepository();
    const job = PriceQuoteJobEntity.create({
      session_id: "sess_x",
      merchant_id: "mrc_x",
      raw_query: "test",
      requested_sources: ["flat-rate"]
    });
    const completed = PriceQuoteJobEntity.rehydrate({ ...job.snapshot(), status: "completed" });
    await repo.save(completed);

    const cancelJob = new CancelQuoteJobUseCase(repo);
    await assert.rejects(
      () => cancelJob.execute({ job_id: completed.id, merchant_id: "mrc_x" }),
      /illegal_transition/
    );
  });

  it("returns a snapshot, not the entity", async () => {
    const { requestQuote, cancelJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);
    const snap = await cancelJob.execute({ job_id: job.id, merchant_id: "mrc_1" });

    // snapshot shape: has plain fields, not the entity class.
    assert.equal(typeof snap.id, "string");
    assert.equal(snap.merchant_id, "mrc_1");
    assert.equal(snap.status, "cancelled");
    // ensure results is a (defensively copied) array
    assert.ok(Array.isArray(snap.results));
  });
});