import { Injectable, Inject, NotFoundException , Logger} from "@nestjs/common";
import { PRICE_QUOTE_JOB_REPOSITORY, type PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class CancelQuoteJobUseCase {
  private readonly logger = new Logger(CancelQuoteJobUseCase.name);

  constructor(
    @Inject(PRICE_QUOTE_JOB_REPOSITORY) private readonly repo: PriceQuoteJobRepository
  ) {}

  async execute(input: { job_id: string; merchant_id: string }) {
    const job = await this.repo.findById(input.job_id, input.merchant_id);
    if (!job) throw new NotFoundException("price_quote_job_not_found");
    const cancelled = job.cancel();
    await this.repo.save(cancelled);
    return cancelled.snapshot();
  }
}
