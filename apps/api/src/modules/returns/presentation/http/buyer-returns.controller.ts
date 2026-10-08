import { Body, Controller, Get, Post, Req, UseGuards, BadRequestException, NotFoundException, Inject, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { BuyerJwtAuthGuard, currentBuyer } from "../../../buyer-account/presentation/http/buyer-jwt-auth.guard.js";
import { RequestReturnUseCase } from "../../application/use-cases/request-return.use-case.js";
import { UploadReturnImageUseCase } from "../../application/use-cases/upload-return-image.use-case.js";
import { RETURN_REPOSITORY_PORT, type ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";

const RETURN_REASON_LABELS: Record<string, string> = {
  DEFECTIVE: "Produto com defeito",
  WRONG_ITEM: "Recebi item errado",
  NOT_AS_DESCRIBED: "Diferente do anúncio",
  CHANGED_MIND: "Mudei de ideia",
  DAMAGED_IN_TRANSIT: "Danificado no transporte",
  OTHER: "Outro motivo",
};

const MAX_RETURN_IMAGES = 3;

@Controller("buyer/returns")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerReturnsController {
  private readonly logger = new Logger(BuyerReturnsController.name);

  constructor(
    private readonly requestReturn: RequestReturnUseCase,
    private readonly uploadReturnImage: UploadReturnImageUseCase,
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    private readonly s3: S3UploadService,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  @Post("request")
  async createReturnRequest(@Req() req: any, @Body() body: {
    orderId: string;
    merchantId: string;
    reason: string;
    title?: string;
    description?: string;
    items: Array<{ variantId: string; quantity: number; reason?: string }>;
    images?: string[];
  }) {
    const buyer = currentBuyer(req);
    const buyerId = buyer.globalUserId;
    if (!body.merchantId?.trim()) throw new BadRequestException("merchant_id_required");
    if (!body.orderId?.trim()) throw new BadRequestException("order_id_required");
    const completed = await this.prisma.completedOrder.findMany({ where: { merchantId: body.merchantId,
      OR: [{ id: body.orderId }, { externalOrderId: body.orderId }] }, select: { externalOrderId: true } });
    const owned = await this.prisma.buyerPurchaseRecord.findFirst({ where: { merchantId: body.merchantId, globalUserId: buyerId,
      orderId: { in: [body.orderId, ...completed.map(row => row.externalOrderId)] } }, select: { id: true } });
    if (!owned) throw new NotFoundException("order_not_found");

    // Upload buyer-supplied photos to S3 (best-effort). uploadBase64 validates the
    // data:image/ prefix and rejects anything else, so non-image payloads are skipped.
    // A single failed upload must not sink the whole return request — we keep the
    // URLs that succeeded and log the rest.
    const imageUrls: string[] = [];
    const images = (body.images ?? []).slice(0, MAX_RETURN_IMAGES);
    for (const img of images) {
      try {
        const { url } = await this.s3.uploadBase64(img, `returns/${body.merchantId}`);
        imageUrls.push(url);
      } catch (err) {
        this.logger.warn(`[returns] image upload skipped: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    const returnEntry = await this.requestReturn.execute({
      merchantId: body.merchantId,
      orderId: body.orderId,
      buyerId,
      reason: body.reason,
      notes: [body.title, body.description].filter(Boolean).join(" — "),
      imageUrls,
      items: body.items,
    });

    return {
      returnId: returnEntry.id,
      status: returnEntry.status,
      imageCount: imageUrls.length,
      ticketId: returnEntry.supportTicketId ?? null,
      message: "Solicitação de devolução criada com sucesso. O merchant será notificado.",
    };
  }

  @Get()
  async listMyReturns(@Req() req: any) {
    const buyer = currentBuyer(req);
    const returns = await this.returnRepo.findByBuyerId(buyer.globalUserId);
    return { returns };
  }

  @Post("upload-image")
  async uploadImage(@Req() req: any, @Body() body: { dataUri: string; merchantId: string }) {
    const buyer = currentBuyer(req);
    if (!body.merchantId?.trim()) throw new BadRequestException("merchant_id_required");

    const result = await this.uploadReturnImage.execute({
      dataUri: body.dataUri,
      merchantId: body.merchantId,
    });

    return { url: result.url };
  }
}
