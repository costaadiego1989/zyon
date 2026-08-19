import { Module } from '@nestjs/common';
import { TeamModule } from '../../team/team.module.js';
import { TeamV1Controller } from './presentation/http/team-v1.controller.js';

@Module({
  imports: [TeamModule],
  controllers: [TeamV1Controller],
})
export class PublicApiTeamModule {}
