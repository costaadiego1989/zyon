import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { ShippingQuotesModule } from '../../shipping/shipping-quotes.module.js';
import { ShippingV1Controller } from './presentation/http/shipping-v1.controller.js';

/**
 * Public API v1 — Shipping submodule.
 *
 * Thin presentation layer that delegates to existing ShippingQuotesModule use-cases.
 * No business logic here — only HTTP → use-case → DTO mapping.
 */
@Module({
  imports: [IntegrationsModule, ShippingQuotesModule],
  controllers: [ShippingV1Controller],
})
export class PublicApiShippingModule {}
