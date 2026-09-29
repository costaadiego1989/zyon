import { BadRequestException, Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { IncentivePolicyService, type IncentivePolicyCommand } from "../../application/incentive-policy.service.js";

@Controller("revenue-manager/incentive-policy")
@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("revenueManager")
export class IncentivePolicyController {
  constructor(private readonly policies: IncentivePolicyService) {}
  @Get()
  read(@Req() req: any) { return this.policies.read(currentUser(req).merchantId); }
  @Put()
  save(@Req() req: any, @Body() body: unknown) {
    const keys = ["enabled", "limitCents", "maxDiscountCents", "maxRedemptions", "expectedVersion", "requestKey"];
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join() !== keys.sort().join()) {
      throw new BadRequestException("INCENTIVE_POLICY_INVALID_COMMAND");
    }
    const user = currentUser(req);
    return this.policies.save(user.merchantId, user.userId, body as IncentivePolicyCommand);
  }
}
