import { Inject, Injectable } from '@nestjs/common';
import { BILLING_PLANS, effectiveBillingPlan } from '../../../../payment/domain/billing-plans.js';
import { BillingPlanMeteringService } from '../../../../payment/domain/billing-plan-guard.js';
import type { UsageResponse } from '../../presentation/http/dtos/billing.dtos.js';
import { BillingEntityMapper } from './mappers/billing-entity.mapper.js';

@Injectable()
export class GetBillingUsageUseCase {
  constructor(
    @Inject(BillingPlanMeteringService)
    private readonly metering: BillingPlanMeteringService,
  ) {}

  async execute(merchantId: string): Promise<UsageResponse> {
    const usage = await this.metering.getUsage(merchantId);
    const plan = await this.metering.getEffectivePlan(merchantId);
    const limits = BILLING_PLANS[plan].limits;
    return BillingEntityMapper.toUsageResponse(usage, limits as Record<string, number | null>);
  }
}
