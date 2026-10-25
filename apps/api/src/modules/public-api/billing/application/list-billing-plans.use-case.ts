import { Injectable } from '@nestjs/common';
import { BILLING_PLANS } from '../../../payment/domain/billing-plans.js';
import type { PlanResponse } from '../presentation/http/dtos/billing.dtos.js';
import { BillingEntityMapper } from './mappers/billing-entity.mapper.js';

@Injectable()
export class ListBillingPlansUseCase {
  execute(): PlanResponse[] {
    return BillingEntityMapper.toPlansResponse();
  }

  changePlan(merchantId: string, input: { plan_id: string; effective?: 'immediate' | 'next_cycle' }) {
    const plan = input.plan_id as keyof typeof BILLING_PLANS;
    if (!BILLING_PLANS[plan]) {
      throw new Error(`Invalid plan: ${plan}`);
    }
    return {
      message: 'Use the billing portal to manage your subscription',
      plan_id: input.plan_id,
      effective: input.effective ?? 'next_cycle',
      portal_url: `${process.env.AACP_CONSOLE_URL}/settings/billing`,
    };
  }
}
