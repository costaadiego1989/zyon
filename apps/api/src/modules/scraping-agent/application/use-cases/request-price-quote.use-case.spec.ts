import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RequestPriceQuoteUseCase } from "./request-price-quote.use-case.js";
import { InMemoryPriceQuoteJobRepository } from "../../infrastructure/repositories/in-memory-price-quote-job.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

function makeSetup() {
  const repo = new InMemoryPriceQuoteJobRepository();
  const outbox = new InMemoryOutboxRepository();
  const useCase = new RequestPriceQuoteUseCase(repo, outbox);
  return { repo, outbox, useCase };
}

const BASE_INPUT = {
  session_id: "sess_1",
  merchant_id: "mrc_1",
  raw_query: "iPhone 15 Pro 256GB",
};

describe("RequestPriceQuoteUseCase", () => {
  it("creates job with pending status and saves it", async () => {
    const { repo, useCase } = makeSetup();
    const snap = await useCase.execute(BASE_INPUT);

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
    const { outbox, useCase } = makeSetup();
    const snap = await useCase.execute(BASE_INPUT);

    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "scraping.job.requested");
    assert.equal((events[0].payload as Record<string, unknown>).job_id, snap.id);
    assert.equal((events[0].payload as Record<string, unknown>).raw_query, "iPhone 15 Pro 256GB");
  });

  it("uses all default sources when none specified", async () => {
    const { useCase } = makeSetup();
    const snap = await useCase.execute(BASE_INPUT);
    assert.ok(snap.requested_sources.length > 0, "should have requested_sources");
  });

  it("filters to allowed sources when sources specified", async () => {
    const { useCase } = makeSetup();
    const snap = await useCase.execute({ ...BASE_INPUT, sources: ["mercado-livre", "amazon-br"] });
    assert.deepEqual(snap.requested_sources.sort(), ["amazon-br", "mercado-livre"].sort());
  });

  it("throws BadRequestException when all requested sources are disallowed", async () => {
    const { useCase } = makeSetup();
    await assert.rejects(
      () => useCase.execute({ ...BASE_INPUT, sources: ["blocked-source-xyz"] }),
      { message: "SOURCE_NOT_ALLOWED" }
    );
  });

  it("attaches buyer_global_user_id when provided", async () => {
    const { useCase } = makeSetup();
    const snap = await useCase.execute({ ...BASE_INPUT, buyer_global_user_id: "usr_1" });
    assert.equal(snap.buyer_global_user_id, "usr_1");
  });

  it("sets buyer_global_user_id to null when omitted", async () => {
    const { useCase } = makeSetup();
    const snap = await useCase.execute(BASE_INPUT);
    assert.equal(snap.buyer_global_user_id, null);
  });
});
