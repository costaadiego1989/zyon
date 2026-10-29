import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WidgetPriceQuoteController } from "./widget-price-quote.controller.js";
import { InMemoryPriceQuoteJobRepository } from "../../infrastructure/repositories/in-memory-price-quote-job.repository.js";
import type { PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";
import type { EmbedHttpRequest } from "../../../embed/presentation/http/embed-checkout.controller.js";

function embedReq(merchantId: string | undefined): EmbedHttpRequest {
  return merchantId
    ? { embedClaims: { merchantId } as never }
    : { embedClaims: undefined };
}

function makeController(opts?: {
  repo?: PriceQuoteJobRepository;
  requestQuote?: { execute: (i: unknown) => Promise<unknown> };
  cancelJob?: { execute: (i: unknown) => Promise<unknown> };
  finalizeJob?: { execute: (i: unknown) => Promise<unknown> };
}) {
  const repo = opts?.repo ?? new InMemoryPriceQuoteJobRepository();
  const requestQuote = opts?.requestQuote ?? {
    async execute(input: unknown) {
      return input;
    }
  };
  const cancelJob = opts?.cancelJob ?? {
    async execute(input: unknown) {
      return input;
    }
  };
  const finalizeJob = opts?.finalizeJob ?? {
    async execute(input: unknown) {
      return input;
    }
  };
  return new WidgetPriceQuoteController(
    requestQuote as never,
    cancelJob as never,
    finalizeJob as never,
    repo
  );
}

// ---------------------------------------------------------------------------
// POST /embed/price-quote  (request)
// ---------------------------------------------------------------------------
describe("WidgetPriceQuoteController.request", () => {
  it("delegates to requestQuote with merchant_id from embed claims", async () => {
    let captured: Record<string, unknown> | undefined;
    const controller = makeController({
      requestQuote: {
        async execute(input) {
          captured = input as Record<string, unknown>;
          return { id: "job_1", status: "pending" };
        }
      }
    });

    const result = await controller.request(embedReq("m_token"), {
      session_id: "sess_1",
      query: "iPhone 15",
      sources: ["flat-rate"],
      buyer_global_user_id: "usr_1"
    });

    assert.ok(captured, "execute must be called");
    assert.equal(captured!.merchant_id, "m_token");
    assert.equal(captured!.session_id, "sess_1");
    assert.equal(captured!.raw_query, "iPhone 15");
    assert.deepEqual(captured!.sources, ["flat-rate"]);
    assert.equal(captured!.buyer_global_user_id, "usr_1");
    assert.equal((result as { id: string }).id, "job_1");
  });

  it("ignores body.merchant_id — always uses claims merchant_id", async () => {
    let captured: Record<string, unknown> | undefined;
    const controller = makeController({
      requestQuote: {
        async execute(input) {
          captured = input as Record<string, unknown>;
          return {};
        }
      }
    });

    await controller.request(embedReq("m_token"), {
      session_id: "sess_1",
      query: "iPhone",
      // @ts-expect-error -- proving claim-based merchant_id wins over body
      merchant_id: "m_evil"
    });

    assert.equal(captured!.merchant_id, "m_token");
  });

  it("trims session_id and query before delegating", async () => {
    let captured: Record<string, unknown> | undefined;
    const controller = makeController({
      requestQuote: {
        async execute(input) {
          captured = input as Record<string, unknown>;
          return {};
        }
      }
    });

    await controller.request(embedReq("m_token"), {
      session_id: "  sess_trim  ",
      query: "  iPhone  "
    });

    assert.equal(captured!.session_id, "sess_trim");
    assert.equal(captured!.raw_query, "iPhone");
  });

  it("rejects when session_id is missing or empty", async () => {
    const controller = makeController();
    await assert.rejects(
      () =>
        controller.request(embedReq("m_token"), {
          session_id: "   ",
          query: "iPhone"
        }),
      { message: "session_id_required" }
    );
  });

  it("rejects when query is missing or empty", async () => {
    const controller = makeController();
    await assert.rejects(
      () =>
        controller.request(embedReq("m_token"), {
          session_id: "sess_1",
          query: ""
        }),
      { message: "query_required" }
    );
  });
});

// ---------------------------------------------------------------------------
// GET /embed/price-quote/:job_id
// ---------------------------------------------------------------------------
describe("WidgetPriceQuoteController.getJob", () => {
  it("returns the snapshot for an existing job", async () => {
    const repo = new InMemoryPriceQuoteJobRepository();
    // Persist a job via repo.save with a known id is not exposed — use the entity factory.
    const { PriceQuoteJobEntity } = await import("../../domain/entities/price-quote-job.entity.js");
    const job = PriceQuoteJobEntity.create({
      session_id: "sess_1",
      merchant_id: "mrc_1",
      raw_query: "test",
      requested_sources: ["flat-rate"]
    });
    await repo.save(job);

    const controller = makeController({ repo });
    const result = await controller.getJob(embedReq("mrc_1"), job.id);

    assert.equal(result.id, job.id);
    assert.equal(result.merchant_id, "mrc_1");
    assert.equal(result.status, "pending");
  });

  it("returns NotFound when the job does not exist", async () => {
    const controller = makeController();
    await assert.rejects(
      () => controller.getJob(embedReq("mrc_1"), "missing-id"),
      { message: "price_quote_job_not_found" }
    );
  });

  it("returns NotFound when merchant_id does not match (tenant isolation)", async () => {
    const repo = new InMemoryPriceQuoteJobRepository();
    const { PriceQuoteJobEntity } = await import("../../domain/entities/price-quote-job.entity.js");
    const job = PriceQuoteJobEntity.create({
      session_id: "sess_1",
      merchant_id: "mrc_1",
      raw_query: "test",
      requested_sources: ["flat-rate"]
    });
    await repo.save(job);

    const controller = makeController({ repo });
    await assert.rejects(
      () => controller.getJob(embedReq("mrc_other"), job.id),
      { message: "price_quote_job_not_found" }
    );
  });

  it("falls back to ?merchant_id query param when claims are missing", async () => {
    const repo = new InMemoryPriceQuoteJobRepository();
    const { PriceQuoteJobEntity } = await import("../../domain/entities/price-quote-job.entity.js");
    const job = PriceQuoteJobEntity.create({
      session_id: "sess_1",
      merchant_id: "mrc_query",
      raw_query: "test",
      requested_sources: ["flat-rate"]
    });
    await repo.save(job);

    const controller = makeController({ repo });
    const result = await controller.getJob(
      { embedClaims: undefined },
      job.id,
      "mrc_query"
    );
    assert.equal(result.id, job.id);
  });

  it("throws BadRequest when no claims and no query param", async () => {
    const controller = makeController();
    await assert.rejects(
      () => controller.getJob({ embedClaims: undefined }, "any"),
      { message: "merchant_id_required" }
    );
  });
});

// ---------------------------------------------------------------------------
// DELETE /embed/price-quote/:job_id  (cancel)
// ---------------------------------------------------------------------------
describe("WidgetPriceQuoteController.cancel", () => {
  it("delegates to cancelJob with claims merchant_id", async () => {
    let captured: Record<string, unknown> | undefined;
    const controller = makeController({
      cancelJob: {
        async execute(input) {
          captured = input as Record<string, unknown>;
          return { id: "job_1", status: "cancelled" };
        }
      }
    });

    const result = await controller.cancel(embedReq("m_token"), "job_1");

    assert.equal(captured!.merchant_id, "m_token");
    assert.equal(captured!.job_id, "job_1");
    assert.equal((result as { status: string }).status, "cancelled");
  });
});

// ---------------------------------------------------------------------------
// POST /embed/price-quote/:job_id/finalize
// ---------------------------------------------------------------------------
describe("WidgetPriceQuoteController.finalize", () => {
  it("delegates to finalizeJob with claims merchant_id and merchant_domain from body", async () => {
    let captured: Record<string, unknown> | undefined;
    const controller = makeController({
      finalizeJob: {
        async execute(input) {
          captured = input as Record<string, unknown>;
          return { id: "job_1", status: "completed" };
        }
      }
    });

    const result = await controller.finalize(embedReq("m_token"), "job_1", {
      merchant_domain: "merchant.com"
    });

    assert.equal(captured!.merchant_id, "m_token");
    assert.equal(captured!.job_id, "job_1");
    assert.equal(captured!.merchant_domain, "merchant.com");
    assert.equal((result as { status: string }).status, "completed");
  });

  it("allows merchant_domain to be omitted (no body)", async () => {
    let captured: Record<string, unknown> | undefined;
    const controller = makeController({
      finalizeJob: {
        async execute(input) {
          captured = input as Record<string, unknown>;
          return {};
        }
      }
    });

    await controller.finalize(embedReq("m_token"), "job_1");

    assert.equal(captured!.merchant_domain, undefined);
    assert.equal(captured!.merchant_id, "m_token");
  });

  it("ignores body.merchant_id — always uses claims", async () => {
    let captured: Record<string, unknown> | undefined;
    const controller = makeController({
      finalizeJob: {
        async execute(input) {
          captured = input as Record<string, unknown>;
          return {};
        }
      }
    });

    await controller.finalize(embedReq("m_token"), "job_1", {
      // @ts-expect-error -- proving claim-based merchant_id wins over body
      merchant_id: "m_evil"
    });

    assert.equal(captured!.merchant_id, "m_token");
  });
});