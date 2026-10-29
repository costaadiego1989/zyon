import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { AuditModule } from '../../audit/audit.module.js';
import { AuditV1Controller } from './presentation/http/audit-v1.controller.js';

@Module({
  imports: [IntegrationsModule, AuditModule],
  controllers: [AuditV1Controller],
})
export class PublicApiAuditModule {}
