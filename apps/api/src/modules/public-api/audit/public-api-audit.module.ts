import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module.js';
import { AuditV1Controller } from './presentation/http/audit-v1.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [AuditV1Controller],
})
export class PublicApiAuditModule {}
