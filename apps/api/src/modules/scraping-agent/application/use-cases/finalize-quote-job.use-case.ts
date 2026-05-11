import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { PRICE_QUOTE_JOB_REPOSITORY, type PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";
import { rankResults } from "../../domain/services/result-ranker.service.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createScrapingEventEnvelope } from "../../domain/events/scraping-domain-event.js";

@Injectable()
export class FinalizeQuoteJobUseCase {
  constructor(
    @Inject(PRICE_QUOTE_JOB_REPOSITORY) private readonly repo: PriceQuoteJobRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: { job_id: string; merchant_id: string }) {
    const job = await this.repo.findById(input.job_id, input.merchant_id);
    if (!job) throw new NotFoundException("price_quote_job_not_found");

    const snap = job.snapshot();
    const rankedIds = rankResults(snap.results);
    const topResult = snap.results.find((r) => r.id === rankedIds[0]);
    const routing = topResult ? "external" : "external";

    const finalized = job.complete(rankedIds, routing);
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
