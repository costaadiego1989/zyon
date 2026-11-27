import { BadRequestException, Controller, Get, HttpException, Inject, NotFoundException, Param, Query, Req, Res, ServiceUnavailableException, StreamableFile, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { BuyerJwtAuthGuard, currentBuyer } from "../../buyer-account/presentation/http/buyer-jwt-auth.guard.js";
import type { FiscalDocumentService } from "../application/fiscal-document.service.js";
export const FISCAL_DOCUMENT_SERVICE = Symbol("FiscalDocumentService");

@Controller("buyer/me/orders/:merchantId/:orderId/fiscal")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerFiscalController {
  constructor(@Inject(FISCAL_DOCUMENT_SERVICE) private readonly documents: FiscalDocumentService) {}
  private scope(request: { user?: unknown }, merchantId: string, environment: string) {
    const buyer = currentBuyer(request);
    if (buyer.merchantId && buyer.merchantId !== merchantId) throw new NotFoundException("fiscal_document_not_found");
    if (environment !== "homologation" && environment !== "production") throw new BadRequestException("fiscal_environment_required");
    return { actor: { kind: "buyer" as const, globalUserId: buyer.globalUserId }, scope: { merchantId, environment: environment as "homologation" | "production" } };
  }
  private error(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof Error && error.message === "fiscal_document_not_found") throw new NotFoundException(error.message);
    if (error instanceof Error && error.message === "fiscal_document_pending") throw new HttpException(error.message, 409);
    throw new ServiceUnavailableException("fiscal_document_unavailable");
  }
  @Get()
  async list(@Req() request: { user?: unknown }, @Param("merchantId") merchantId: string, @Param("orderId") orderId: string, @Query("environment") environment: string, @Res({ passthrough: true }) response: Response) {
    try { const { actor, scope } = this.scope(request, merchantId, environment); response.setHeader("Cache-Control", "private, no-store"); return { environment, items: await this.documents.forOrder(actor, { ...scope, orderId }) }; }
    catch (error) { this.error(error); }
  }
  @Get(":intentId/documents/:kind")
  async download(@Req() request: { user?: unknown }, @Param("merchantId") merchantId: string, @Param("orderId") orderId: string, @Param("intentId") intentId: string, @Param("kind") kind: string, @Query("environment") environment: string, @Res({ passthrough: true }) response: Response) {
    try {
      const { actor, scope } = this.scope(request, merchantId, environment);
      const notes = await this.documents.forOrder(actor, { ...scope, orderId });
      const note = notes.find(row => row.intentId === intentId); if (!note) throw new NotFoundException("fiscal_document_not_found");
      if (kind !== "xml" && kind !== "danfe") throw new BadRequestException("fiscal_document_kind_invalid");
      const file = await this.documents.download(actor, { ...scope, merchantId: note.sellerMerchantId }, intentId, kind);
      response.setHeader("Cache-Control", "private, no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(Buffer.from(file.bytes), { type: file.mimeType, disposition: `attachment; filename="nota-fiscal.${kind === "xml" ? "xml" : "pdf"}"`, length: file.bytes.length });
    } catch (error) { this.error(error); }
  }
}
