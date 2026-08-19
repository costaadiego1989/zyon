import { Module } from '@nestjs/common';
import { ShippingQuotesModule } from '../../shipping/shipping-quotes.module.js';
import { ShippingV1Controller } from './presentation/http/shipping-v1.controller.js';

/**
 * Public API v1 — Shipping submodule.
 *
 * Thin presentation layer that delegates to existing ShippingQuotesModule use-cases.
 * No business logic here — only HTTP → use-case → DTO mapping.
 */
@Module({
  imports: [ShippingQuotesModule],
  controllers: [ShippingV1Controller],
})
export class PublicApiShippingModule {}
