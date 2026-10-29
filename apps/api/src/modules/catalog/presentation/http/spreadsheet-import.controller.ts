import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { EnqueueSpreadsheetImportUseCase } from "../../application/use-cases/enqueue-spreadsheet-import.use-case.js";
import { GetImportJobUseCase } from "../../application/use-cases/get-import-job.use-case.js";

/**
 * AI spreadsheet import (Growth+). A merchant uploads their own product
 * spreadsheet (any reasonable layout, CSV or XLSX); an async job parses it,
 * LLM-maps the columns to our schema, and bulk-creates products. Gated by the
 * billing `aiSpreadsheetImport` feature — Starter merchants keep the fixed CSV
 * template flow instead.
 */
@UseGuards(AuthGuard, MerchantOwnershipGuard)
@Controller("merchants")
export class SpreadsheetImportController {
  constructor(
    private readonly enqueue: EnqueueSpreadsheetImportUseCase,
    private readonly getJob: GetImportJobUseCase,
  ) {}

  @Post(":mid/products/import")
  @UseGuards(PlanLimitGuard)
  @RequirePlanFeature("aiSpreadsheetImport")
  async upload(
    @Param("mid") merchantId: string,
    @Body() body: { fileName: string; mimeType: string; base64: string },
  ) {
    return this.enqueue.execute({
      merchantId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      base64: body.base64,
    });
  }

  @Get(":mid/products/import/:jobId")
  async status(
    @Param("mid") merchantId: string,
    @Param("jobId") jobId: string,
  ) {
    return this.getJob.execute({ jobId, merchantId });
  }
}
