import { Module } from '@nestjs/common';
import { InstallationsModule } from '../../installations/installations.module.js';
import { InstallationsV1Controller } from './presentation/http/installations-v1.controller.js';

@Module({
  imports: [InstallationsModule],
  controllers: [InstallationsV1Controller],
})
export class PublicApiInstallationsModule {}
