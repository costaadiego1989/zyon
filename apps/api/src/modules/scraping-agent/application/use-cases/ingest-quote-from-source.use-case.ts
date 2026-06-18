import { ConflictException, Injectable, Inject, NotFoundException } from "@nestjs/common";
import type { PriceQuoteResult } from "../../domain/entities/price-quote-job.entity.js";
import { PRICE_QUOTE_JOB_REPOSITORY, type PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";

@Injectable()
export class IngestQuoteFromSourceUseCase {
  constructor(
    @Inject(PRICE_QUOTE_JOB_REPOSITORY) private readonly repo: PriceQuoteJobRepository
  ) {}

  async execute(input: { job_id: string; merchant_id: string; result: PriceQuoteResult }) {
    const job = await this.repo.findById(input.job_id, input.merchant_id);
    if (!job) throw new NotFoundException("price_quote_job_not_found");

    // P2 fix: reject ingest on terminal jobs with a 409 instead of letting
    // entity.ingestResult throw "illegal_transition" as an unhandled 500.
    if (job.status === "completed" || job.status === "cancelled" || job.status === "failed") {
      throw new ConflictException("price_quote_job_already_terminal");
    }

    // Transition pending → running on first ingest.
    const running = job.status === "pending" ? job.start(null) : job;

    // P2 fix: upsertResult deduplicates by result.id — redelivered results replace rather
    // than append, preventing inflated rankings from duplicate callbacks.
    const withResult = running.upsertResult(input.result);
    await this.repo.save(withResult);
    return withResult.snapshot();
  }
}
