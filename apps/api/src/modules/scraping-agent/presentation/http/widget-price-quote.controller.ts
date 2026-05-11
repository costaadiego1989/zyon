import { Controller, Get, Post, Delete, Body, Param } from "@nestjs/common";
import { RequestPriceQuoteUseCase } from "../../application/use-cases/request-price-quote.use-case.js";
import { CancelQuoteJobUseCase } from "../../application/use-cases/cancel-quote-job.use-case.js";
import { FinalizeQuoteJobUseCase } from "../../application/use-cases/finalize-quote-job.use-case.js";
import { PRICE_QUOTE_JOB_REPOSITORY, type PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";
import { Inject } from "@nestjs/common";

@Controller("embed/price-quote")
export class WidgetPriceQuoteController {
  constructor(
    private readonly requestQuote: RequestPriceQuoteUseCase,
    private readonly cancelJob: CancelQuoteJobUseCase,
    private readonly finalizeJob: FinalizeQuoteJobUseCase,
    @Inject(PRICE_QUOTE_JOB_REPOSITORY) private readonly repo: PriceQuoteJobRepository
  ) {}

  @Post()
  async request(@Body() body: { session_id: string; merchant_id: string; query: string; sources?: string[]; buyer_global_user_id?: string }) {
    return this.requestQuote.execute({ ...body, raw_query: body.query });
  }

  @Get(":job_id")
  async getJob(@Param("job_id") jobId: string, @Body() body: { merchant_id: string }) {
    return this.repo.findById(jobId, body.merchant_id);
  }

  @Delete(":job_id")
  async cancel(@Param("job_id") jobId: string, @Body() body: { merchant_id: string }) {
    return this.cancelJob.execute({ job_id: jobId, merchant_id: body.merchant_id });
  }

  @Post(":job_id/finalize")
  async finalize(@Param("job_id") jobId: string, @Body() body: { merchant_id: string }) {
    return this.finalizeJob.execute({ job_id: jobId, merchant_id: body.merchant_id });
  }
}
