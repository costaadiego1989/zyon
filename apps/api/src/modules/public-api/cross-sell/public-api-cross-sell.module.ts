import { Module } from '@nestjs/common';
import { CrossSellModule } from '../../cross-sell/cross-sell.module.js';
import { CrossSellV1Controller } from './presentation/http/cross-sell-v1.controller.js';

/**
 * Public API v1 — Cross-Sell submodule.
 *
 * Thin presentation layer that delegates to existing CrossSellModule use-cases.
 * No business logic here — only HTTP → use-case → DTO mapping.
 */
@Module({
  imports: [CrossSellModule],
  controllers: [CrossSellV1Controller],
})
export class PublicApiCrossSellModule {}
