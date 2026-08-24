import { Body, Controller, Get, Post, Req, UseGuards, BadRequestException } from "@nestjs/common";
import { BuyerAuthGuard } from "../../../self-checkout/presentation/guards/buyer-auth.guard.js";
import { RequestReturnUseCase } from "../../application/use-cases/request-return.use-case.js";
import { RETURN_REPOSITORY_PORT, type ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { Inject } from "@nestjs/common";

@Controller("buyer/returns")
@UseGuards(BuyerAuthGuard)
export class BuyerReturnsController {
  constructor(
    private readonly requestReturn: RequestReturnUseCase,
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
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
    const buyerId = req.buyerUser?.globalUserId;
    if (!buyerId) throw new BadRequestException("buyer_not_authenticated");
    if (!body.merchantId?.trim()) throw new BadRequestException("merchant_id_required");

    const returnEntry = await this.requestReturn.execute({
      merchantId: body.merchantId,
      orderId: body.orderId,
      buyerId,
      reason: body.reason,
      notes: [body.title, body.description].filter(Boolean).join(" — "),
      items: body.items,
    });

    return {
      returnId: returnEntry.id,
      status: returnEntry.status,
      message: "Solicitação de devolução criada com sucesso. O merchant será notificado.",
    };
  }

  @Get()
  async listMyReturns(@Req() req: any) {
    const buyerId = req.buyerUser?.globalUserId;
    if (!buyerId) throw new BadRequestException("buyer_not_authenticated");
    const returns = await this.returnRepo.findByBuyerId(buyerId);
    return { returns };
  }
}
