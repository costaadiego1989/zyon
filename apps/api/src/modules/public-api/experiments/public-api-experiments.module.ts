import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { ExperimentsModule } from '../../experiments/experiments.module.js';
import { ExperimentsV1Controller } from './presentation/http/experiments-v1.controller.js';
import { BillingPlanMeteringService, PlanLimitGuard } from '../../payment/domain/billing-plan-guard.js';

@Module({
  imports: [IntegrationsModule, ExperimentsModule],
  controllers: [ExperimentsV1Controller],
  providers: [BillingPlanMeteringService, PlanLimitGuard],
})
export class PublicApiExperimentsModule {}
