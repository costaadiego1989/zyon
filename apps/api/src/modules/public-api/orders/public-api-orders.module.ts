import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { OperationsModule } from '../../operations/operations.module.js';
import { OrdersV1Controller } from './presentation/http/orders-v1.controller.js';

/**
 * Public API v1 — Orders submodule.
 *
 * Thin presentation layer that delegates to existing OperationsModule use-cases.
 * No business logic here — only HTTP → use-case → DTO mapping.
 */
@Module({
  imports: [IntegrationsModule, OperationsModule],
  controllers: [OrdersV1Controller],
})
export class PublicApiOrdersModule {}
