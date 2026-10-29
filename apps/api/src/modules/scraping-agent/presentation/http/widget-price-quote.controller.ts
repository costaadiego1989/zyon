import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import { RequestPriceQuoteUseCase } from "../../application/use-cases/request-price-quote.use-case.js";
import { CancelQuoteJobUseCase } from "../../application/use-cases/cancel-quote-job.use-case.js";
import { FinalizeQuoteJobUseCase } from "../../application/use-cases/finalize-quote-job.use-case.js";
import { PRICE_QUOTE_JOB_REPOSITORY, type PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";
import type { EmbedHttpRequest } from "../../../embed/presentation/http/embed-checkout.controller.js";

/**
 * P1 fix: Apply EmbedAuthGuard so all routes require a valid embed session token.
 * merchant_id is derived from embed claims (request.embedClaims.merchantId) and never
 * trusted from the request body or URL — satisfying the tenant boundary invariant.
 *
 * P2 fix: GET :job_id no longer reads merchant_id from @Body() (most clients drop GET bodies).
 * merchant_id is now derived from claims (preferred) or accepted as a ?merchant_id query param
 * for backwards compatibility with non-embed callers that still need scoping.
 */
@NonProductionRoute()
@UseGuards(EmbedAuthGuard)
@Controller("embed/price-quote")
export class WidgetPriceQuoteController {
  constructor(
    private readonly requestQuote: RequestPriceQuoteUseCase,
    private readonly cancelJob: CancelQuoteJobUseCase,
    private readonly finalizeJob: FinalizeQuoteJobUseCase,
    @Inject(PRICE_QUOTE_JOB_REPOSITORY) private readonly repo: PriceQuoteJobRepository
  ) {}

  @Post()
  @Idempotent()
  async request(
    @Req() req: EmbedHttpRequest,
    @Body() body: { session_id: string; query: string; sources?: string[]; buyer_global_user_id?: string }
  ) {
    if (typeof body.session_id !== "string" || !body.session_id.trim()) {
      throw new BadRequestException("session_id_required");
    }
    if (typeof body.query !== "string" || !body.query.trim()) {
      throw new BadRequestException("query_required");
    }
    // P1 fix: merchant_id always from claims — body.merchant_id ignored.
    const merchant_id = req.embedClaims!.merchantId;
    return this.requestQuote.execute({
      session_id: body.session_id.trim(),
      merchant_id,
      raw_query: body.query.trim(),
      sources: body.sources,
      buyer_global_user_id: body.buyer_global_user_id,
      // P2 note: merchant_allowed_sources would come from merchant config lookup here.
      // Until the merchant config repo is wired into this module, omit to use platform default.
    });
  }

  /**
   * P2 fix: GET no longer reads merchant_id from @Body() — derives from embed claims instead.
   * If claims are missing (non-embed caller), falls back to ?merchant_id query param.
   */
  @Get(":job_id")
  async getJob(
    @Req() req: EmbedHttpRequest,
    @Param("job_id") jobId: string,
    @Query("merchant_id") queryMerchantId?: string
  ) {
    const merchant_id = req.embedClaims?.merchantId ?? queryMerchantId;
    if (!merchant_id) throw new BadRequestException("merchant_id_required");
    const job = await this.repo.findById(jobId, merchant_id);
    if (!job) throw new NotFoundException("price_quote_job_not_found");
    return job.snapshot();
  }

  @Delete(":job_id")
  async cancel(@Req() req: EmbedHttpRequest, @Param("job_id") jobId: string) {
    // P1 fix: merchant_id from claims.
    const merchant_id = req.embedClaims!.merchantId;
    return this.cancelJob.execute({ job_id: jobId, merchant_id });
  }

  @Post(":job_id/finalize")
  @Idempotent()
  async finalize(
    @Req() req: EmbedHttpRequest,
    @Param("job_id") jobId: string,
    @Body() body?: { merchant_domain?: string }
  ) {
    // P1 fix: merchant_id from claims.
    const merchant_id = req.embedClaims!.merchantId;
    return this.finalizeJob.execute({
      job_id: jobId,
      merchant_id,
      // P1 routing fix: caller may supply merchant_domain so decidePurchaseRouting can run.
      merchant_domain: body?.merchant_domain,
    });
  }
}
