import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { ExperimentsModule } from '../../experiments/experiments.module.js';
import { ExperimentsV1Controller } from './presentation/http/experiments-v1.controller.js';

@Module({
  imports: [IntegrationsModule, ExperimentsModule],
  controllers: [ExperimentsV1Controller],
})
export class PublicApiExperimentsModule {}
