import { Module } from '@nestjs/common';
import { ReturnsModule } from '../../returns/returns.module.js';
import { ReturnsV1Controller } from './presentation/http/returns-v1.controller.js';

@Module({
  imports: [ReturnsModule],
  controllers: [ReturnsV1Controller],
})
export class PublicApiReturnsModule {}
