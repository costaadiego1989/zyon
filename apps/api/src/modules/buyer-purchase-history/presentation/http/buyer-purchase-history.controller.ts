import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { GetBuyerPurchaseContextUseCase } from "../../application/buyer-purchase-history.use-cases.js";

@UseGuards(AuthGuard)
@Controller("buyer-purchase-history")
export class BuyerPurchaseHistoryController {
  constructor(private readonly getContext: GetBuyerPurchaseContextUseCase) {}

  @Get("global-users/:globalUserId/context")
  getByGlobalUser(@Req() request: { user?: unknown }, @Param("globalUserId") globalUserId: string) {
    const user = currentUser(request);
    return this.getContext.execute({
      merchantId: user.merchantId,
      globalUserId
    });
  }
}
