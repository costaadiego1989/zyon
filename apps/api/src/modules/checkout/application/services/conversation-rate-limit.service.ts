import { createHash } from "node:crypto";
import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { BillingPlanMeteringService } from "../../../payment/domain/billing-plan-guard.js";
import { DistributedRateLimitStore } from "../../../../shared/http/rate-limit.store.js";
import {
  CONVERSATION_RATE_LIMIT_WINDOW_MS,
  conversationRateLimitForPlan,
} from "./conversation-rate-limit.policy.js";

/**
 * Short-lived anti-abuse protection for every AI conversation. It is not a
 * monthly conversation quota and is isolated to a conversation, never a
 * merchant-wide ceiling.
 */
@Injectable()
export class ConversationRateLimitService {
  constructor(
    private readonly metering: BillingPlanMeteringService,
    private readonly store: DistributedRateLimitStore,
  ) {}

  async assertAllowed(input: { merchantId: string; sessionId: string }): Promise<void> {
    const merchantId = input.merchantId.trim();
    const sessionId = input.sessionId.trim();
    const policy = conversationRateLimitForPlan(await this.metering.getEffectivePlan(merchantId));
    const decision = await this.hit(
      `ai-chat:conversation:${hash(merchantId)}:${hash(sessionId)}`,
      policy.messagesPerMinute,
    );

    if (!decision.allowed) this.reject(decision.retryAfterMs, policy);
  }

  private async hit(key: string, limit: number) {
    try {
      return await this.store.hit(key, limit, CONVERSATION_RATE_LIMIT_WINDOW_MS);
    } catch {
      throw new ServiceUnavailableException({
        code: "ai_rate_limit_unavailable",
        scope: "conversation",
      });
    }
  }

  private reject(
    retryAfterMs: number,
    policy: ReturnType<typeof conversationRateLimitForPlan>,
  ): never {
    throw new HttpException({
      code: "ai_interaction_rate_limited",
      scope: "conversation",
      retry_after_seconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
    }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
