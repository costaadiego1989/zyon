import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBody,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';
import { PlanLimitGuard, RequirePlanFeature } from '../../../../payment/domain/billing-plan-guard.js';

import { RegisterDomainUseCase } from '../../../../domains/application/use-cases/register-domain.use-case.js';
import { VerifyDomainUseCase } from '../../../../domains/application/use-cases/verify-domain.use-case.js';
import { ListDomainsUseCase } from '../../../../domains/application/use-cases/list-domains.use-case.js';
import { DomainEntityMapper } from '../../application/mappers/domain-entity.mapper.js';
import { RegisterDomainDto, DomainResponse, RegisterDomainResponse, VerifyDomainResponse } from './dtos/domain.dtos.js';

/**
 * Public API v1 — Domains
 *
 * RESTful resource controller for custom domain management.
 * Delegates to existing DomainsModule use-cases.
 *
 * Auth: Bearer API key (service) or session cookie (human/dashboard).
 * Tenant: Automatically scoped by global TenantGuard + TenantInterceptor.
 */
@ApiTags('Domains')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('domains')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard, PlanLimitGuard)
@RequirePlanFeature('customDomain')
export class DomainsV1Controller {
  constructor(
    private readonly registerDomainUseCase: RegisterDomainUseCase,
    private readonly verifyDomainUseCase: VerifyDomainUseCase,
    private readonly listDomainsUseCase: ListDomainsUseCase,
  ) {}

  /**
   * GET /v1/domains
   * List all registered domains for the merchant.
   */
  @Get()
  @RequireTenantAccess({ serviceScopes: ['configuration:read'] })
  @ApiOperation({ summary: 'List registered domains' })
  @ApiOkResponse({ description: 'Domains list', type: DomainResponse, isArray: true })
  async list(@Req() req: any) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const domains = await this.listDomainsUseCase.execute(merchantId);

    return {
      data: domains.map((d: any) => DomainEntityMapper.toDomainResponse(d)),
    };
  }

  /**
   * POST /v1/domains
   * Register a new custom domain.
   */
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['configuration:read'] })
  @ApiOperation({ summary: 'Register a custom domain' })
  @ApiBody({ type: RegisterDomainDto })
  @ApiCreatedResponse({ description: 'Domain registered', type: RegisterDomainResponse })
  async register(@Req() req: any, @Body() body: RegisterDomainDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.registerDomainUseCase.execute({
      merchant_id: merchantId,
      domain: body.domain_name,
    });

    return DomainEntityMapper.toRegisterDomainResponse(result);
  }

  /**
   * POST /v1/domains/:domainId/verify
   * Verify a registered domain via DNS CNAME check.
   */
  @Post(':domainId/verify')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['configuration:read'] })
  @ApiOperation({ summary: 'Verify a registered domain' })
  @ApiOkResponse({ description: 'Domain verified', type: VerifyDomainResponse })
  async verify(@Req() req: any, @Param('domainId') domainId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.verifyDomainUseCase.execute({
      merchant_id: merchantId,
      domain_id: domainId,
    });

    return DomainEntityMapper.toVerifyDomainResponse(result);
  }
}
