import { Injectable, Inject, NotFoundException } from "@nestjs/common";
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

    const updated = job.status === "pending" ? job.start(null) : job;
    const withResult = updated.ingestResult(input.result);
    await this.repo.save(withResult);
    return withResult.snapshot();
  }
}
