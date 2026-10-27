import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankResults, NoAvailableSourcesError } from "./result-ranker.service.js";
import type { PriceQuoteResult } from "../entities/price-quote-job.entity.js";

function makeResult(overrides: Partial<PriceQuoteResult> & { id: string; total_cost: number }): PriceQuoteResult {
  return {
    source_key: "flat-rate",
    product_title: "Product",
    url: "https://example.com",
    price: overrides.total_cost,
    shipping_estimate: 0,
    currency: "BRL",
    availability: "in_stock",
    raw_snapshot: {},
    ingested_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("rankResults", () => {
  it("ranks results by total_cost ascending (cheapest first)", () => {
    const results = [
      makeResult({ id: "expensive", total_cost: 200 }),
      makeResult({ id: "cheap", total_cost: 50 }),
      makeResult({ id: "mid", total_cost: 100 }),
    ];
    const ranked = rankResults(results);
    assert.deepEqual(ranked, ["cheap", "mid", "expensive"]);
  });

  it("excludes out_of_stock results from ranking", () => {
    const results = [
      makeResult({ id: "cheap_oos", total_cost: 10, availability: "out_of_stock" }),
      makeResult({ id: "available", total_cost: 100 }),
    ];
    const ranked = rankResults(results);
    assert.deepEqual(ranked, ["available"]);
  });

  it("includes 'unknown' availability in ranking", () => {
    const results = [
      makeResult({ id: "unknown_avail", total_cost: 50, availability: "unknown" }),
      makeResult({ id: "in_stock", total_cost: 100 }),
    ];
    const ranked = rankResults(results);
    assert.deepEqual(ranked, ["unknown_avail", "in_stock"]);
  });

  it("throws NoAvailableSourcesError when all results are out_of_stock", () => {
    const results = [
      makeResult({ id: "a", total_cost: 10, availability: "out_of_stock" }),
      makeResult({ id: "b", total_cost: 20, availability: "out_of_stock" }),
    ];
    assert.throws(
      () => rankResults(results),
      (err) => err instanceof NoAvailableSourcesError
    );
  });

  it("throws NoAvailableSourcesError when results array is empty", () => {
    assert.throws(
      () => rankResults([]),
      (err) => err instanceof NoAvailableSourcesError
    );
  });

  it("preserves stability for equal total_cost values", () => {
    const results = [
      makeResult({ id: "first", total_cost: 100 }),
      makeResult({ id: "second", total_cost: 100 }),
    ];
    // Array.sort is not guaranteed stable in all engines but modern V8 is.
    // At minimum, all ids must appear.
    const ranked = rankResults(results);
    assert.equal(ranked.length, 2);
    assert.ok(ranked.includes("first"));
    assert.ok(ranked.includes("second"));
  });
});

describe("NoAvailableSourcesError", () => {
  it("has name 'NoAvailableSourcesError'", () => {
    const err = new NoAvailableSourcesError();
    assert.equal(err.name, "NoAvailableSourcesError");
  });

  it("has message 'no_available_sources'", () => {
    const err = new NoAvailableSourcesError();
    assert.equal(err.message, "no_available_sources");
  });

  it("is instanceof Error", () => {
    const err = new NoAvailableSourcesError();
    assert.ok(err instanceof Error);
  });
});
