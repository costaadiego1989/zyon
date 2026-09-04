import { Controller, ForbiddenException, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { BUYER_IDENTITY_REPOSITORY, type BuyerIdentityRepository } from "../../domain/ports/buyer-identity.repository.port.js";
import { GetBuyerPurchaseContextUseCase } from "../../application/buyer-purchase-history.use-cases.js";

@UseGuards(AuthGuard)
@Controller("buyer-purchase-history")
export class BuyerPurchaseHistoryController {
  constructor(
    private readonly getContext: GetBuyerPurchaseContextUseCase,
    @Inject(BUYER_IDENTITY_REPOSITORY) private readonly buyerIdentity: BuyerIdentityRepository
  ) {}

  @Get("global-users/:globalUserId/context")
  async getByGlobalUser(@Req() request: { user?: unknown }, @Param("globalUserId") globalUserId: string) {
    const user = currentUser(request);
    const merchantId = user.merchantId;

    // R2P-B04 fix: enforce merchantId from JWT, not from params
    // Repository filters by (merchantId, globalUserId), preventing cross-merchant data leaks.
    // The TenantGuard global middleware also validates merchantId mismatch in params.

    return this.getContext.execute({
      merchantId,
      globalUserId
    });
  }
}
