import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PriceQuoteJobEntity,
  type PriceQuoteResult,
  type ProductQuery
} from "./price-quote-job.entity.js";

function makeJob(overrides?: Partial<{
  session_id: string;
  merchant_id: string;
  raw_query: string;
  buyer_global_user_id: string;
  requested_sources: string[];
}>) {
  return PriceQuoteJobEntity.create({
    session_id: "sess_test",
    merchant_id: "mrc_test",
    raw_query: "test query",
    requested_sources: ["flat-rate"],
    ...overrides,
  });
}

function makeResult(overrides?: Partial<PriceQuoteResult>): PriceQuoteResult {
  return {
    id: "res_1",
    source_key: "flat-rate",
    product_title: "Product",
    url: "https://shop.example.com/item",
    price: 100,
    shipping_estimate: 10,
    total_cost: 110,
    currency: "BRL",
    availability: "in_stock",
    raw_snapshot: {},
    ingested_at: new Date().toISOString(),
    ...overrides,
  };
}

const PRODUCT_QUERY: ProductQuery = {
  normalized_name: "Product",
  brand: null,
  model: null,
  attributes: {}
};

// ---------------------------------------------------------------------------
// PriceQuoteJobEntity.create — factory invariants
// ---------------------------------------------------------------------------
describe("PriceQuoteJobEntity.create", () => {
  it("creates a job in pending status with trimmed raw_query", () => {
    const job = makeJob({ raw_query: "  hello world  " });
    const snap = job.snapshot();
    assert.equal(snap.status, "pending");
    assert.equal(snap.raw_query, "hello world");
    assert.ok(snap.id, "id must be assigned");
    assert.ok(snap.created_at, "created_at must be assigned");
    assert.equal(snap.results.length, 0);
    assert.equal(snap.ranked_results.length, 0);
    assert.equal(snap.routing_decision, null);
    assert.equal(snap.started_at, null);
    assert.equal(snap.completed_at, null);
    assert.equal(snap.normalized_query, null);
  });

  it("defaults buyer_global_user_id to null", () => {
    const job = makeJob();
    assert.equal(job.snapshot().buyer_global_user_id, null);
  });

  it("preserves buyer_global_user_id when provided", () => {
    const job = makeJob({ buyer_global_user_id: "usr_xyz" });
    assert.equal(job.snapshot().buyer_global_user_id, "usr_xyz");
  });

  it("throws when merchant_id is empty", () => {
    assert.throws(
      () => makeJob({ merchant_id: "   " }),
      /scraping_job_merchant_required/
    );
  });

  it("throws when raw_query is empty", () => {
    assert.throws(
      () => makeJob({ raw_query: "   " }),
      /scraping_job_query_required/
    );
  });

  it("throws when requested_sources is empty", () => {
    assert.throws(
      () => makeJob({ requested_sources: [] }),
      /scraping_job_sources_required/
    );
  });

  it("exposes id and merchant_id via getters", () => {
    const job = makeJob();
    assert.equal(typeof job.id, "string");
    assert.equal(job.merchant_id, "mrc_test");
    assert.equal(job.status, "pending");
  });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------
describe("PriceQuoteJobEntity transitions", () => {
  it("start() transitions pending → running and stamps started_at", () => {
    const job = makeJob();
    const running = job.start(PRODUCT_QUERY);

    assert.equal(running.status, "running");
    assert.ok(running.snapshot().started_at, "started_at must be set");
    assert.deepEqual(running.snapshot().normalized_query, PRODUCT_QUERY);
  });

  it("start() rejects re-entry on a non-pending job", () => {
    const job = makeJob().start(null);
    assert.throws(() => job.start(null), /illegal_transition/);
  });

  it("ingestResult appends and preserves running status", () => {
    const running = makeJob().start(null);
    const after = running.ingestResult(makeResult({ id: "res_a" }));

    assert.equal(after.status, "running");
    assert.equal(after.snapshot().results.length, 1);
    assert.equal(after.snapshot().results[0].id, "res_a");
  });

  it("ingestResult rejects when not running", () => {
    const pending = makeJob();
    assert.throws(() => pending.ingestResult(makeResult()), /illegal_transition/);
  });

  it("upsertResult replaces existing entry with same id (idempotent)", () => {
    const running = makeJob().start(null);
    const first = running.upsertResult(makeResult({ id: "res_dup", price: 100 }));
    const second = first.upsertResult(makeResult({ id: "res_dup", price: 80 }));

    const snap = second.snapshot();
    assert.equal(snap.results.length, 1, "must not duplicate on upsert");
    assert.equal(snap.results[0].price, 80, "must use latest value");
  });

  it("upsertResult appends new ids", () => {
    const running = makeJob().start(null);
    const after = running
      .upsertResult(makeResult({ id: "res_a" }))
      .upsertResult(makeResult({ id: "res_b" }));

    assert.equal(after.snapshot().results.length, 2);
  });

  it("upsertResult rejects when not running", () => {
    const pending = makeJob();
    assert.throws(() => pending.upsertResult(makeResult()), /illegal_transition/);
  });

  it("complete() transitions running → completed with ranked ids and routing", () => {
    const running = makeJob().start(null);
    const done = running.complete(["r1", "r2"], "integrated");

    const snap = done.snapshot();
    assert.equal(snap.status, "completed");
    assert.deepEqual(snap.ranked_results, ["r1", "r2"]);
    assert.equal(snap.routing_decision, "integrated");
    assert.ok(snap.completed_at);
  });

  it("complete() rejects when not running", () => {
    const pending = makeJob();
    assert.throws(() => pending.complete(["r1"], "external"), /illegal_transition/);
  });

  it("fail() sets status to failed from any state and stamps completed_at", () => {
    const running = makeJob().start(null);
    const failed = running.fail();

    const snap = failed.snapshot();
    assert.equal(snap.status, "failed");
    assert.ok(snap.completed_at);
  });

  it("fail() can also mark a pending job as failed", () => {
    const failed = makeJob().fail();
    assert.equal(failed.snapshot().status, "failed");
  });

  it("cancel() transitions pending → cancelled", () => {
    const cancelled = makeJob().cancel();
    const snap = cancelled.snapshot();
    assert.equal(snap.status, "cancelled");
    assert.ok(snap.completed_at);
  });

  it("cancel() rejects when already completed", () => {
    const completed = PriceQuoteJobEntity.rehydrate({
      ...makeJob().snapshot(),
      status: "completed"
    });
    assert.throws(() => completed.cancel(), /illegal_transition/);
  });

  it("cancel() rejects when already failed", () => {
    const failed = makeJob().fail();
    assert.throws(() => failed.cancel(), /illegal_transition/);
  });

  it("cancel() is allowed from running state", () => {
    const running = makeJob().start(null);
    const cancelled = running.cancel();
    assert.equal(cancelled.snapshot().status, "cancelled");
  });
});

// ---------------------------------------------------------------------------
// snapshot() — defensive copy of results
// ---------------------------------------------------------------------------
describe("PriceQuoteJobEntity.snapshot", () => {
  it("returns a defensively copied results array (mutating snapshot does not affect entity)", () => {
    const running = makeJob().start(null).ingestResult(makeResult({ id: "res_1" }));
    const snap = running.snapshot();

    // mutate the snapshot results
    (snap.results as PriceQuoteResult[]).push(makeResult({ id: "res_2" }));

    // re-fetching snapshot must still show only 1 result
    const snap2 = running.snapshot();
    assert.equal(snap2.results.length, 1);
  });
});

// ---------------------------------------------------------------------------
// rehydrate — round-trip identity
// ---------------------------------------------------------------------------
describe("PriceQuoteJobEntity.rehydrate", () => {
  it("preserves all snapshot fields exactly", () => {
    const original = makeJob();
    const snap = original.snapshot();
    const rehydrated = PriceQuoteJobEntity.rehydrate(snap);

    const reSnap = rehydrated.snapshot();
    assert.equal(reSnap.id, snap.id);
    assert.equal(reSnap.merchant_id, snap.merchant_id);
    assert.equal(reSnap.session_id, snap.session_id);
    assert.equal(reSnap.raw_query, snap.raw_query);
    assert.equal(reSnap.status, snap.status);
    assert.deepEqual(reSnap.requested_sources, snap.requested_sources);
  });
});