import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { ReturnsModule } from '../../returns/returns.module.js';
import { ReturnsV1Controller } from './presentation/http/returns-v1.controller.js';

@Module({
  imports: [IntegrationsModule, ReturnsModule],
  controllers: [ReturnsV1Controller],
})
export class PublicApiReturnsModule {}
