import { Inject, Injectable } from "@nestjs/common";
import {
  ORDER_QUOTA_REPOSITORY,
  type OrderQuotaRepository,
} from "../../domain/ports/order-quota.repository.port.js";
import {
  orderQuotaNoticeContent,
  requiredPlanForOrderQuota,
  type OrderQuotaNoticeMilestone,
} from "../../domain/services/order-quota-notice.policy.js";
import type { OrderQuotaNoticeContext } from "../../domain/services/order-quota.types.js";

/** Owns merchant-facing copy and the idempotent notice envelope. */
@Injectable()
export class OrderQuotaNoticePublisher {
  constructor(
    @Inject(ORDER_QUOTA_REPOSITORY) private readonly repository: OrderQuotaRepository,
  ) {}

  async publish(
    milestone: OrderQuotaNoticeMilestone,
    context: OrderQuotaNoticeContext,
    repository: OrderQuotaRepository = this.repository,
  ): Promise<boolean> {
    const content = orderQuotaNoticeContent(milestone, context);
    return repository.persistNotice({
      merchantId: context.merchantId,
      period: context.period,
      episode: context.episode,
      milestone,
      title: content.title,
      body: content.body,
      metadata: {
        plan: context.plan,
        ordersUsed: context.usedOrders,
        ordersLimit: context.limit,
        periodStart: context.period.start.toISOString(),
        periodEnd: context.period.end.toISOString(),
        state: context.state,
        graceExpiresAt: context.episode.graceExpiresAt.toISOString(),
        requiredPlan: requiredPlanForOrderQuota(context.plan),
      },
    });
  }
}
