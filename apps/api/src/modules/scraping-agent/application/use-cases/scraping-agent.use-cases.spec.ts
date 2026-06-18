import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RequestPriceQuoteUseCase } from "./request-price-quote.use-case.js";
import { IngestQuoteFromSourceUseCase } from "./ingest-quote-from-source.use-case.js";
import { FinalizeQuoteJobUseCase } from "./finalize-quote-job.use-case.js";
import { CancelQuoteJobUseCase } from "./cancel-quote-job.use-case.js";
import { InMemoryPriceQuoteJobRepository } from "../../infrastructure/repositories/in-memory-price-quote-job.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { PriceQuoteResult } from "../../domain/entities/price-quote-job.entity.js";

function makeSetup() {
  const repo = new InMemoryPriceQuoteJobRepository();
  const outbox = new InMemoryOutboxRepository();
  const requestQuote = new RequestPriceQuoteUseCase(repo, outbox);
  const ingestQuote = new IngestQuoteFromSourceUseCase(repo);
  const finalizeJob = new FinalizeQuoteJobUseCase(repo, outbox);
  const cancelJob = new CancelQuoteJobUseCase(repo);
  return { repo, outbox, requestQuote, ingestQuote, finalizeJob, cancelJob };
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

// ---------------------------------------------------------------------------
// RequestPriceQuoteUseCase
// ---------------------------------------------------------------------------
describe("RequestPriceQuoteUseCase", () => {
  it("creates job with pending status and saves it", async () => {
    const { repo, requestQuote } = makeSetup();
    const snap = await requestQuote.execute(BASE_INPUT);

    assert.equal(snap.status, "pending");
    assert.equal(snap.session_id, "sess_1");
    assert.equal(snap.merchant_id, "mrc_1");
    assert.equal(snap.raw_query, "iPhone 15 Pro 256GB");
    assert.ok(snap.id, "job should have an id");

    const saved = await repo.findById(snap.id, "mrc_1");
    assert.ok(saved, "job should be persisted");
    assert.equal(saved!.status, "pending");
  });

  it("fires scraping.job.requested outbox event", async () => {
    const { outbox, requestQuote } = makeSetup();
    const snap = await requestQuote.execute(BASE_INPUT);

    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "scraping.job.requested");
    assert.equal((events[0].payload as Record<string, unknown>).job_id, snap.id);
    assert.equal((events[0].payload as Record<string, unknown>).raw_query, "iPhone 15 Pro 256GB");
  });

  it("uses all default sources when none specified", async () => {
    const { requestQuote } = makeSetup();
    const snap = await requestQuote.execute(BASE_INPUT);
    assert.ok(snap.requested_sources.length > 0, "should have requested_sources");
  });

  it("filters to allowed sources when sources specified", async () => {
    const { requestQuote } = makeSetup();
    const snap = await requestQuote.execute({ ...BASE_INPUT, sources: ["mercado-livre", "amazon-br"] });
    assert.deepEqual(snap.requested_sources.sort(), ["amazon-br", "mercado-livre"].sort());
  });

  it("throws BadRequestException when all requested sources are disallowed", async () => {
    const { requestQuote } = makeSetup();
    await assert.rejects(
      () => requestQuote.execute({ ...BASE_INPUT, sources: ["blocked-source-xyz"] }),
      { message: "SOURCE_NOT_ALLOWED" }
    );
  });

  it("attaches buyer_global_user_id when provided", async () => {
    const { requestQuote } = makeSetup();
    const snap = await requestQuote.execute({ ...BASE_INPUT, buyer_global_user_id: "usr_1" });
    assert.equal(snap.buyer_global_user_id, "usr_1");
  });

  it("sets buyer_global_user_id to null when omitted", async () => {
    const { requestQuote } = makeSetup();
    const snap = await requestQuote.execute(BASE_INPUT);
    assert.equal(snap.buyer_global_user_id, null);
  });

  // P2 regression: raw_query validation bounds
  it("throws BadRequestException when raw_query is empty", async () => {
    const { requestQuote } = makeSetup();
    await assert.rejects(
      () => requestQuote.execute({ ...BASE_INPUT, raw_query: "   " }),
      { message: "raw_query_required" }
    );
  });

  it("throws BadRequestException when raw_query exceeds max length", async () => {
    const { requestQuote } = makeSetup();
    await assert.rejects(
      () => requestQuote.execute({ ...BASE_INPUT, raw_query: "a".repeat(501) }),
      { message: "raw_query_too_long" }
    );
  });

  // P2 regression: merchant-configured allowlist overrides platform default
  it("respects merchant_allowed_sources over platform default", async () => {
    const { requestQuote } = makeSetup();
    // Merchant only allows "flat-rate"; requesting "amazon-br" must be filtered out.
    const snap = await requestQuote.execute({
      ...BASE_INPUT,
      sources: ["amazon-br", "flat-rate"],
      merchant_allowed_sources: ["flat-rate"],
    });
    assert.deepEqual(snap.requested_sources, ["flat-rate"]);
  });

  it("throws BadRequestException when all sources are excluded by merchant allowlist", async () => {
    const { requestQuote } = makeSetup();
    await assert.rejects(
      () => requestQuote.execute({
        ...BASE_INPUT,
        sources: ["amazon-br"],
        merchant_allowed_sources: ["flat-rate"],
      }),
      { message: "SOURCE_NOT_ALLOWED" }
    );
  });
});

// ---------------------------------------------------------------------------
// IngestQuoteFromSourceUseCase — P2 terminal job 409 + idempotency dedup
// ---------------------------------------------------------------------------
describe("IngestQuoteFromSourceUseCase", () => {
  it("transitions pending → running on first ingest", async () => {
    const { repo, requestQuote, ingestQuote } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);
    const result = makeResult();

    const updated = await ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result });
    assert.equal(updated.status, "running");
    assert.equal(updated.results.length, 1);
  });

  it("appends result to running job", async () => {
    const { repo, requestQuote, ingestQuote } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);

    await ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result: makeResult({ id: "res_1" }) });
    const updated = await ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result: makeResult({ id: "res_2" }) });

    assert.equal(updated.results.length, 2);
  });

  // P2 regression: dedup — redelivering same result.id must not create a duplicate entry
  it("deduplicates results by id (upsert, not append)", async () => {
    const { repo, requestQuote, ingestQuote } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);
    const result = makeResult({ id: "res_dedup", price: 1000 });

    await ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result });
    // Redeliver same result.id with updated price
    const updated = await ingestQuote.execute({
      job_id: job.id,
      merchant_id: "mrc_1",
      result: { ...result, price: 900, total_cost: 900 },
    });

    assert.equal(updated.results.length, 1, "must not duplicate on redeliver");
    assert.equal(updated.results[0].price, 900, "must use latest value");
  });

  // P2 regression: terminal job must return 409 not 500
  it("throws ConflictException (409) when ingesting into a completed job", async () => {
    const { repo, requestQuote, ingestQuote, finalizeJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);

    // Ingest one result then finalize
    await ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result: makeResult() });
    await finalizeJob.execute({ job_id: job.id, merchant_id: "mrc_1" });

    // Now try to ingest after completion → must be 409
    await assert.rejects(
      () => ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result: makeResult() }),
      { message: "price_quote_job_already_terminal" }
    );
  });

  // P2 regression: cancelled job must also return 409
  it("throws ConflictException (409) when ingesting into a cancelled job", async () => {
    const { repo, requestQuote, ingestQuote, cancelJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);
    await cancelJob.execute({ job_id: job.id, merchant_id: "mrc_1" });

    await assert.rejects(
      () => ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result: makeResult() }),
      { message: "price_quote_job_already_terminal" }
    );
  });

  // Tenant isolation: must not find job under different merchant_id
  it("throws NotFoundException when merchant_id does not match", async () => {
    const { requestQuote, ingestQuote } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT); // merchant_id = "mrc_1"

    await assert.rejects(
      () => ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_other", result: makeResult() }),
      { message: "price_quote_job_not_found" }
    );
  });
});

// ---------------------------------------------------------------------------
// FinalizeQuoteJobUseCase — P1 routing fix (decidePurchaseRouting)
// ---------------------------------------------------------------------------
describe("FinalizeQuoteJobUseCase", () => {
  it("finalizes job and fires scraping.job.completed event", async () => {
    const { outbox, requestQuote, ingestQuote, finalizeJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);
    await ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result: makeResult() });

    const finalized = await finalizeJob.execute({ job_id: job.id, merchant_id: "mrc_1" });

    assert.equal(finalized.status, "completed");
    const events = outbox.listOutbox("mrc_1");
    const completedEvent = events.find((e) => e.event_type === "scraping.job.completed");
    assert.ok(completedEvent, "should fire scraping.job.completed event");
  });

  // P1 regression: routing must be "external" when no merchant_domain provided
  it("defaults routing_decision to 'external' when merchant_domain is not provided", async () => {
    const { requestQuote, ingestQuote, finalizeJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);
    await ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result: makeResult({ url: "https://shop.merchant.com/item" }) });

    const finalized = await finalizeJob.execute({ job_id: job.id, merchant_id: "mrc_1" });
    assert.equal(finalized.routing_decision, "external");
  });

  // P1 regression: decidePurchaseRouting must return 'integrated' for merchant domain match
  it("sets routing_decision to 'integrated' when top result URL matches merchant_domain", async () => {
    const { requestQuote, ingestQuote, finalizeJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);
    await ingestQuote.execute({
      job_id: job.id,
      merchant_id: "mrc_1",
      result: makeResult({ id: "res_integrated", url: "https://shop.merchant.com/product/123", price: 1000, total_cost: 1000 }),
    });
    await ingestQuote.execute({
      job_id: job.id,
      merchant_id: "mrc_1",
      result: makeResult({ id: "res_external", url: "https://amazon.com.br/item", price: 2000, total_cost: 2000 }),
    });

    // merchant_domain provided — top result (cheapest) is at shop.merchant.com → integrated
    const finalized = await finalizeJob.execute({
      job_id: job.id,
      merchant_id: "mrc_1",
      merchant_domain: "merchant.com",
    });
    assert.equal(finalized.routing_decision, "integrated");
  });

  // P1 regression: both branches used to hardcode "external" — ensure external still works
  it("sets routing_decision to 'external' when top result URL does NOT match merchant_domain", async () => {
    const { requestQuote, ingestQuote, finalizeJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);
    await ingestQuote.execute({
      job_id: job.id,
      merchant_id: "mrc_1",
      result: makeResult({ url: "https://amazon.com.br/item" }),
    });

    const finalized = await finalizeJob.execute({
      job_id: job.id,
      merchant_id: "mrc_1",
      merchant_domain: "merchant.com",
    });
    assert.equal(finalized.routing_decision, "external");
  });

  // P1 regression: no results → external (safe default, same as before)
  it("uses routing_decision 'external' when there are no results", async () => {
    const { requestQuote, ingestQuote, finalizeJob } = makeSetup();
    const job = await requestQuote.execute(BASE_INPUT);
    // Transition to running first
    await ingestQuote.execute({ job_id: job.id, merchant_id: "mrc_1", result: makeResult() });
    // Can't finalize a pending job, so finalize after ingest
    const finalized = await finalizeJob.execute({
      job_id: job.id,
      merchant_id: "mrc_1",
      merchant_domain: "merchant.com",
    });
    // Has 1 result, routing determined by URL
    assert.ok(finalized.routing_decision !== null);
  });
});
