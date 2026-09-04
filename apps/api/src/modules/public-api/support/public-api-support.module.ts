import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { SupportModule } from '../../support/support.module.js';
import { SupportV1Controller } from './presentation/http/support-v1.controller.js';

@Module({
  imports: [IntegrationsModule, SupportModule],
  controllers: [SupportV1Controller],
})
export class PublicApiSupportModule {}
