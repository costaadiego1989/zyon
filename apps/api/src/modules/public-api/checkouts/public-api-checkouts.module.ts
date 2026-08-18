import { Module } from '@nestjs/common';
import { CheckoutModule } from '../../checkout/checkout.module.js';
import { CheckoutsV1Controller } from './presentation/http/checkouts-v1.controller.js';

/**
 * Public API v1 — Checkouts submodule.
 *
 * Thin presentation layer that delegates to existing CheckoutModule use-cases.
 * No business logic here — only HTTP → use-case → DTO mapping.
 */
@Module({
  imports: [CheckoutModule],
  controllers: [CheckoutsV1Controller],
})
export class PublicApiCheckoutsModule {}
