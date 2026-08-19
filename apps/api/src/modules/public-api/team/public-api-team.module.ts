import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { TeamModule } from '../../team/team.module.js';
import { TeamV1Controller } from './presentation/http/team-v1.controller.js';

@Module({
  imports: [IntegrationsModule, TeamModule],
  controllers: [TeamV1Controller],
})
export class PublicApiTeamModule {}
