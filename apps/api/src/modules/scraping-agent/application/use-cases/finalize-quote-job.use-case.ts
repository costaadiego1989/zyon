import { Injectable, Inject, NotFoundException, ConflictException } from "@nestjs/common";
import { PRICE_QUOTE_JOB_REPOSITORY, type PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";
import { rankResults, NoAvailableSourcesError } from "../../domain/services/result-ranker.service.js";
import { decidePurchaseRouting } from "../../domain/policies/purchase-routing.policy.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createScrapingEventEnvelope } from "../../domain/events/scraping-domain-event.js";

@Injectable()
export class FinalizeQuoteJobUseCase {
  constructor(
    @Inject(PRICE_QUOTE_JOB_REPOSITORY) private readonly repo: PriceQuoteJobRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: { job_id: string; merchant_id: string; merchant_domain?: string }) {
    const job = await this.repo.findById(input.job_id, input.merchant_id);
    if (!job) throw new NotFoundException("price_quote_job_not_found");

    const snap = job.snapshot();

    // P1 fix: rankResults now throws if no results are in stock. Fail the job instead of completing with empty results.
    let rankedIds: string[];
    try {
      rankedIds = rankResults(snap.results);
    } catch (err) {
      if (err instanceof NoAvailableSourcesError) {
        const failed = job.fail();
        await this.repo.save(failed);
        throw new ConflictException("no_available_sources");
      }
      throw err;
    }

    const topResult = snap.results.find((r) => r.id === rankedIds[0]);

    // P1 fix: was `topResult ? "external" : "external"` — both branches hardcoded "external".
    // Now calls decidePurchaseRouting when a top result exists and a merchant domain is provided.
    // Falls back to "external" when no results or no domain configured (safe default).
    const routing = topResult && input.merchant_domain
      ? decidePurchaseRouting(topResult, input.merchant_domain)
      : "external";

    const finalized = job.complete(rankedIds, routing);

    // P1 note: save + appendOutbox are two separate awaits.
    // Full atomicity requires a Prisma transactional outbox (ADR 0003).
    // Blocked until Prisma repos are wired (ADR 0004).
    await this.repo.save(finalized);

    await this.outbox.appendOutbox(
      createScrapingEventEnvelope({
        eventType: "scraping.job.completed",
        merchantId: input.merchant_id,
        payload: {
          job_id: input.job_id,
          total_sources_completed: snap.results.length,
          top_result_id: rankedIds[0] ?? null,
          routing_decision: routing
        }
      })
    );

    return finalized.snapshot();
  }
}
