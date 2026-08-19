import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { InstallationsModule } from '../../installations/installations.module.js';
import { InstallationsV1Controller } from './presentation/http/installations-v1.controller.js';

@Module({
  imports: [IntegrationsModule, InstallationsModule],
  controllers: [InstallationsV1Controller],
})
export class PublicApiInstallationsModule {}
