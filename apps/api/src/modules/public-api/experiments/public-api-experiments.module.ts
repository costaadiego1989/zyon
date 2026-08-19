import { Module } from '@nestjs/common';
import { ExperimentsModule } from '../../experiments/experiments.module.js';
import { ExperimentsV1Controller } from './presentation/http/experiments-v1.controller.js';

@Module({
  imports: [ExperimentsModule],
  controllers: [ExperimentsV1Controller],
})
export class PublicApiExperimentsModule {}
