import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FlatRateSourceAdapter } from "./flat-rate-source.adapter.js";
import type { ProductQuery } from "../../domain/entities/price-quote-job.entity.js";

const QUERY: ProductQuery = {
  normalized_name: "iPhone 15 Pro",
  brand: null,
  model: null,
  attributes: {}
};

describe("FlatRateSourceAdapter", () => {
  it("exposes sourceKey = 'flat-rate'", () => {
    const adapter = new FlatRateSourceAdapter();
    assert.equal(adapter.sourceKey, "flat-rate");
  });

  it("returns exactly one result", async () => {
    const adapter = new FlatRateSourceAdapter();
    const results = await adapter.fetchQuote(QUERY, "mrc_1");
    assert.equal(results.length, 1);
  });

  it("returns a result with the configured flat price and shipping", async () => {
    const adapter = new FlatRateSourceAdapter();
    const [result] = await adapter.fetchQuote(QUERY, "mrc_1");

    assert.equal(result.price, 99.9);
    assert.equal(result.shipping_estimate, 15.0);
    // total_cost = price + shipping - coupon(0) = 114.9
    assert.equal(result.total_cost, 114.9);
  });

  it("uses the query's normalized_name as product_title", async () => {
    const adapter = new FlatRateSourceAdapter();
    const [result] = await adapter.fetchQuote(QUERY, "mrc_1");
    assert.equal(result.product_title, "iPhone 15 Pro");
  });

  it("tags the result with source_key = 'flat-rate'", async () => {
    const adapter = new FlatRateSourceAdapter();
    const [result] = await adapter.fetchQuote(QUERY, "mrc_1");
    assert.equal(result.source_key, "flat-rate");
  });

  it("marks availability as in_stock", async () => {
    const adapter = new FlatRateSourceAdapter();
    const [result] = await adapter.fetchQuote(QUERY, "mrc_1");
    assert.equal(result.availability, "in_stock");
  });

  it("returns currency = 'BRL'", async () => {
    const adapter = new FlatRateSourceAdapter();
    const [result] = await adapter.fetchQuote(QUERY, "mrc_1");
    assert.equal(result.currency, "BRL");
  });

  it("assigns a unique id per call (no de-dup)", async () => {
    const adapter = new FlatRateSourceAdapter();
    const [a] = await adapter.fetchQuote(QUERY, "mrc_1");
    const [b] = await adapter.fetchQuote(QUERY, "mrc_1");
    assert.notEqual(a.id, b.id, "fresh id per fetch");
    assert.ok(a.id, "id must be non-empty");
    assert.ok(b.id, "id must be non-empty");
  });

  it("stamps ingested_at with the current time", async () => {
    const adapter = new FlatRateSourceAdapter();
    const before = Date.now();
    const [result] = await adapter.fetchQuote(QUERY, "mrc_1");
    const after = Date.now();

    const ts = Date.parse(result.ingested_at);
    assert.ok(!Number.isNaN(ts), "ingested_at must be a valid ISO timestamp");
    assert.ok(ts >= before && ts <= after, "ingested_at must fall between before/after");
  });

  it("returns an empty raw_snapshot object", async () => {
    const adapter = new FlatRateSourceAdapter();
    const [result] = await adapter.fetchQuote(QUERY, "mrc_1");
    assert.deepEqual(result.raw_snapshot, {});
  });

  it("ignores merchant_id argument (does not vary by tenant)", async () => {
    const adapter = new FlatRateSourceAdapter();
    const [a] = await adapter.fetchQuote(QUERY, "mrc_A");
    const [b] = await adapter.fetchQuote(QUERY, "mrc_B");
    assert.equal(a.price, b.price);
    assert.equal(a.shipping_estimate, b.shipping_estimate);
  });
});