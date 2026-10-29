import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPriceQuoteJobRepository } from "./in-memory-price-quote-job.repository.js";
import { PriceQuoteJobEntity } from "../../domain/entities/price-quote-job.entity.js";

function makeJob(input: {
  id?: string;
  session_id: string;
  merchant_id: string;
  raw_query?: string;
}) {
  return PriceQuoteJobEntity.create({
    session_id: input.session_id,
    merchant_id: input.merchant_id,
    raw_query: input.raw_query ?? "test",
    requested_sources: ["flat-rate"]
  });
}

describe("InMemoryPriceQuoteJobRepository", () => {
  describe("save", () => {
    it("persists a job by id", async () => {
      const repo = new InMemoryPriceQuoteJobRepository();
      const job = makeJob({ session_id: "s_1", merchant_id: "m_1" });

      await repo.save(job);
      const fetched = await repo.findById(job.id, "m_1");

      assert.ok(fetched, "job must be findable after save");
      assert.equal(fetched!.id, job.id);
    });

    it("overwrites an existing job on save (last-write-wins)", async () => {
      const repo = new InMemoryPriceQuoteJobRepository();
      const job = makeJob({ session_id: "s_1", merchant_id: "m_1" });
      await repo.save(job);

      const cancelled = job.cancel();
      await repo.save(cancelled);

      const fetched = await repo.findById(job.id, "m_1");
      assert.equal(fetched!.status, "cancelled");
    });
  });

  describe("findById", () => {
    it("returns null when job does not exist", async () => {
      const repo = new InMemoryPriceQuoteJobRepository();
      const result = await repo.findById("missing", "m_1");
      assert.equal(result, null);
    });

    it("returns null when merchant_id does not match (tenant isolation)", async () => {
      const repo = new InMemoryPriceQuoteJobRepository();
      const job = makeJob({ session_id: "s_1", merchant_id: "m_1" });
      await repo.save(job);

      const result = await repo.findById(job.id, "m_other");
      assert.equal(result, null);
    });

    it("returns the job when both id and merchant_id match", async () => {
      const repo = new InMemoryPriceQuoteJobRepository();
      const job = makeJob({ session_id: "s_1", merchant_id: "m_1" });
      await repo.save(job);

      const result = await repo.findById(job.id, "m_1");
      assert.ok(result);
      assert.equal(result!.merchant_id, "m_1");
    });
  });

  describe("findBySession", () => {
    it("returns jobs matching both session_id and merchant_id", async () => {
      const repo = new InMemoryPriceQuoteJobRepository();
      const a = makeJob({ session_id: "sess_A", merchant_id: "mrc_1" });
      const b = makeJob({ session_id: "sess_A", merchant_id: "mrc_1" });
      const c = makeJob({ session_id: "sess_B", merchant_id: "mrc_1" });
      await repo.save(a);
      await repo.save(b);
      await repo.save(c);

      const result = await repo.findBySession("sess_A", "mrc_1");
      assert.equal(result.length, 2);
      const ids = result.map((j) => j.id).sort();
      assert.deepEqual(ids, [a.id, b.id].sort());
    });

    it("excludes jobs from a different merchant (tenant isolation)", async () => {
      const repo = new InMemoryPriceQuoteJobRepository();
      const a = makeJob({ session_id: "sess_A", merchant_id: "mrc_1" });
      const b = makeJob({ session_id: "sess_A", merchant_id: "mrc_2" });
      await repo.save(a);
      await repo.save(b);

      const result = await repo.findBySession("sess_A", "mrc_1");
      assert.equal(result.length, 1);
      assert.equal(result[0].id, a.id);
    });

    it("returns empty array when no jobs match", async () => {
      const repo = new InMemoryPriceQuoteJobRepository();
      const result = await repo.findBySession("sess_unknown", "mrc_1");
      assert.deepEqual(result, []);
    });

    it("returns empty array when session matches but merchant does not", async () => {
      const repo = new InMemoryPriceQuoteJobRepository();
      await repo.save(makeJob({ session_id: "sess_A", merchant_id: "mrc_1" }));

      const result = await repo.findBySession("sess_A", "mrc_other");
      assert.deepEqual(result, []);
    });
  });
});