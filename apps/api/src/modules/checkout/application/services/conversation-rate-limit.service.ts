import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { BillingPlanMeteringService } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { DistributedRateLimitStore } from "../../../../shared/http/rate-limit.store.js";
import { AiUserRateLimitService } from "../../../../shared/http/ai-user-rate-limit.service.js";

/** Checkout shares the user bucket with storefront and voice, independently of monthly plan metering. */
@Injectable()
export class ConversationRateLimitService {
  constructor(_metering: BillingPlanMeteringService, private readonly store: DistributedRateLimitStore) {}

  async assertAllowed(input: { merchantId: string; sessionId: string; userId?: string }): Promise<void> {
    if (!input.userId) throw new ServiceUnavailableException({ code: "ai_user_identity_required" });
    await new AiUserRateLimitService(this.store).assertAllowed(input.userId);
  }
}
