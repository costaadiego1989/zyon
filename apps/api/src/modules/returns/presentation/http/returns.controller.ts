import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, Inject, NotFoundException, BadRequestException, Req, Header } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { RequirePlan } from "../../../../shared/guards/require-plan.decorator.js";
import { RequirePlanGuard } from "../../../../shared/guards/require-plan.guard.js";
import { RequestReturnUseCase } from "../../application/use-cases/request-return.use-case.js";
import { GenerateReturnLabelUseCase } from "../../application/use-cases/generate-return-label.use-case.js";
import { MarkReturnReceivedUseCase } from "../../application/use-cases/mark-return-received.use-case.js";
import { InspectReturnUseCase } from "../../application/use-cases/inspect-return.use-case.js";
import { ProcessRefundUseCase } from "../../application/use-cases/process-refund.use-case.js";
import { RestockInventoryUseCase } from "../../application/use-cases/restock-inventory.use-case.js";
import { ListReturnsUseCase } from "../../application/use-cases/list-returns.use-case.js";
import { CancelReturnUseCase } from "../../application/use-cases/cancel-return.use-case.js";
import { AcceptMarketplaceReturnUseCase } from "../../application/use-cases/accept-marketplace-return.use-case.js";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnStatus, ItemCondition } from "../../domain/entities/return.entity.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import type { MarketplaceRefundComponents } from "../../../marketplace/domain/services/marketplace-refund-allocation.js";
import { ReturnReverseShippingService, type ReversePreparation } from "../../application/return-reverse-shipping.service.js";

@UseGuards(AuthGuard, MerchantOwnershipGuard, RequirePlanGuard)
@Controller("merchants")
export class ReturnsController {
  constructor(
    private readonly requestReturn: RequestReturnUseCase,
    private readonly generateLabel: GenerateReturnLabelUseCase,
    private readonly markReceived: MarkReturnReceivedUseCase,
    private readonly inspectReturn: InspectReturnUseCase,
    private readonly processRefund: ProcessRefundUseCase,
    private readonly restockInventory: RestockInventoryUseCase,
    private readonly listReturns: ListReturnsUseCase,
    private readonly cancelReturn: CancelReturnUseCase,
    private readonly acceptMarketplaceReturn: AcceptMarketplaceReturnUseCase,
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    @Inject(ReturnReverseShippingService) private readonly reverseShipping: ReturnReverseShippingService,
  ) {}

  @Post(":mid/returns")
  @RequirePlan("STORE_ONLY", "BOTH")
  async create(
    @Param("mid") merchantId: string,
    @Body() body: {
      orderId: string;
      buyerId: string;
      reason: string;
      notes?: string;
      items: Array<{ variantId: string; quantity: number; reason?: string }>;
    },
  ) {
    return this.requestReturn.execute({
      merchantId,
      orderId: body.orderId,
      buyerId: body.buyerId,
      reason: body.reason,
      notes: body.notes,
      items: body.items,
    });
  }

  @Get(":mid/returns")
  @RequirePlan("STORE_ONLY", "BOTH")
  async list(
    @Param("mid") merchantId: string,
    @Query("status") status?: ReturnStatus,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.listReturns.execute({
      merchantId,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  @Get(":mid/returns/:rid")
  @RequirePlan("STORE_ONLY", "BOTH")
  async getOne(@Param("mid") merchantId: string, @Param("rid") returnId: string) {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    return ret;
  }

  @Post(":mid/returns/:rid/label")
  @RequirePlan("STORE_ONLY", "BOTH")
  async label(@Param("mid") merchantId: string, @Param("rid") returnId: string,
    @Body() body?: { carrier: string; trackingNumber: string; labelUrl?: string }) {
    return this.generateLabel.execute(merchantId, returnId, body);
  }

  @Get(":mid/returns/:rid/reverse-shipping")
  @Header("Cache-Control", "no-store")
  @RequirePlan("STORE_ONLY", "BOTH")
  async reverseDetail(@Param("mid") merchantId: string, @Param("rid") returnId: string) {
    return this.reverseShipping.candidates(merchantId, returnId);
  }

  @Post(":mid/returns/:rid/reverse-shipping/prepare")
  @Header("Cache-Control", "no-store")
  @RequirePlan("STORE_ONLY", "BOTH")
  @RequireTenantRoles("owner", "admin")
  async reversePrepare(@Param("mid") merchantId: string, @Param("rid") returnId: string, @Body() body: ReversePreparation) {
    return this.reverseShipping.prepare(merchantId, returnId, body);
  }

  @Post(":mid/returns/:rid/reverse-shipping/confirm")
  @Header("Cache-Control", "no-store")
  @RequirePlan("STORE_ONLY", "BOTH")
  @RequireTenantRoles("owner", "admin")
  async reverseConfirm(@Param("mid") merchantId: string, @Param("rid") returnId: string, @Body() body: { expectedAmountCents: number }) {
    return this.reverseShipping.confirm(merchantId, returnId, body?.expectedAmountCents);
  }

  @Post(":mid/returns/:rid/receive")
  @RequirePlan("STORE_ONLY", "BOTH")
  async receive(@Param("mid") merchantId: string, @Param("rid") returnId: string) {
    return this.markReceived.execute(merchantId, returnId);
  }

  @Post(":mid/returns/:rid/accept")
  @Header("Cache-Control", "no-store")
  @RequireTenantRoles("owner", "admin")
  async accept(@Param("mid") merchantId: string, @Param("rid") returnId: string, @Body() body?: { components?: MarketplaceRefundComponents }) {
    if (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "components"))) {
      throw new BadRequestException("invalid_return_acceptance_request");
    }
    return this.acceptMarketplaceReturn.execute({ merchantId, returnId, components: body?.components });
  }

  @Post(":mid/returns/:rid/inspect")
  @RequirePlan("STORE_ONLY", "BOTH")
  async inspect(
    @Req() request: { user?: unknown },
    @Param("mid") merchantId: string,
    @Param("rid") returnId: string,
    @Body() body: { itemCondition: ItemCondition; verdict: string; notes?: string },
  ) {
    return this.inspectReturn.execute(merchantId, returnId, {
      ...body,
      inspectedBy: currentUser(request).userId,
    });
  }

  @Post(":mid/returns/:rid/refund")
  @Header("Cache-Control", "no-store")
  @RequireTenantRoles("owner", "admin")
  async refund(@Param("mid") merchantId: string, @Param("rid") returnId: string) {
    return this.processRefund.execute(merchantId, returnId);
  }

  @Get(":mid/returns/:rid/refund-preview")
  @Header("Cache-Control", "no-store")
  @RequireTenantRoles("owner", "admin")
  async refundPreview(@Param("mid") merchantId: string, @Param("rid") returnId: string) {
    return this.processRefund.preview(merchantId, returnId);
  }

  @Post(":mid/returns/:rid/restock")
  @RequirePlan("STORE_ONLY", "BOTH")
  async restock(@Param("mid") merchantId: string, @Param("rid") returnId: string) {
    return this.restockInventory.execute(merchantId, returnId);
  }

  @Put(":mid/returns/:rid/cancel")
  @RequirePlan("STORE_ONLY", "BOTH")
  async cancel(@Param("mid") merchantId: string, @Param("rid") returnId: string) {
    return this.cancelReturn.execute(merchantId, returnId);
  }
}
