import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { OperationsModule } from '../../operations/operations.module.js';
import { CustomersV1Controller } from './presentation/http/customers-v1.controller.js';

@Module({
  imports: [IntegrationsModule, OperationsModule],
  controllers: [CustomersV1Controller],
})
export class PublicApiCustomersModule {}
