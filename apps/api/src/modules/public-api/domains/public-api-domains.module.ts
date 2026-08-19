import { Module } from '@nestjs/common';
import { DomainsModule } from '../../domains/domains.module.js';
import { DomainsV1Controller } from './presentation/http/domains-v1.controller.js';

/**
 * Public API v1 — Domains Module
 *
 * Exposes custom domain management endpoints.
 * Thin presentation layer delegating to DomainsModule.
 */
@Module({
  imports: [DomainsModule],
  controllers: [DomainsV1Controller],
})
export class PublicApiDomainsModule {}
