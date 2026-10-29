import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import type { MerchantNegotiationPolicy } from "@zyon/negotiation-engine";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import {
  GetMerchantNegotiationPolicyUseCase,
  UpsertMerchantNegotiationPolicyUseCase
} from "../../application/merchant-negotiation-policy.use-cases.js";

@UseGuards(AuthGuard)
@Controller("merchant-negotiation-policy")
export class MerchantNegotiationPolicyController {
  constructor(
    private readonly getPolicy: GetMerchantNegotiationPolicyUseCase,
    private readonly upsertPolicy: UpsertMerchantNegotiationPolicyUseCase
  ) {}

  @Get()
  async get(@Req() request: unknown) {
    const user = currentUser(request as { user?: unknown });
    // Bug 8 fix: fetch the stored row once; derive both has_custom_policy and
    // resolved (fallback to default) from that single value — one DB round-trip.
    const { stored } = await this.getPolicy.executeStored(user.merchantId);
    const resolved = this.getPolicy.resolvedFromStored(stored);
    return { has_custom_policy: stored !== null, policy: resolved };
  }

  @Put()
  async put(@Req() request: unknown, @Body() body: MerchantNegotiationPolicy & { merchantId?: string }) {
    const user = currentUser(request as { user?: unknown });
    await this.upsertPolicy.execute({ merchantId: user.merchantId, policy: body });
    const { stored } = await this.getPolicy.executeStored(user.merchantId);
    const resolved = this.getPolicy.resolvedFromStored(stored);
    return { policy: resolved };
  }
}
