import { Inject, Injectable } from '@nestjs/common';
import { BILLING_PLANS } from '../../../payment/domain/billing-plans.js';
import { BillingPlanMeteringService } from '../../../payment/domain/billing-plan-guard.js';
import type { UsageResponse } from '../presentation/http/dtos/billing.dtos.js';
import { BillingEntityMapper } from './mappers/billing-entity.mapper.js';
import { OrderQuotaService } from '../../../payment/application/services/order-quota.service.js';

@Injectable()
export class GetBillingUsageUseCase {
  constructor(
    @Inject(BillingPlanMeteringService)
    private readonly metering: BillingPlanMeteringService,
    private readonly orderQuota?: OrderQuotaService,
  ) {}

  async execute(merchantId: string): Promise<UsageResponse> {
    const usage = await this.metering.getUsage(merchantId);
    const plan = await this.metering.getEffectivePlan(merchantId);
    const limits = BILLING_PLANS[plan].limits;
    return BillingEntityMapper.toUsageResponse(
      usage,
      limits as Record<string, number | null>,
      await this.orderQuota?.getSnapshot(merchantId),
    );
  }
}
