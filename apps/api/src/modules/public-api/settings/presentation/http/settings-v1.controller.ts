import {
  Body,
  Controller,
  Get,
  Headers,
  Put,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiResponse,
} from '@nestjs/swagger';
import type { CheckoutSettingsPatch } from '@zyon/shared-types';
import type { AgentRulesPatch } from '../../../../agent-rules/domain/agent-rules.types.js';
import type { Response } from 'express';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { EntityTagService } from '../../../../../shared/http/entity-tag.service.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { GetCheckoutSettingsUseCase, UpdateCheckoutSettingsUseCase } from '../../../../checkout-settings/application/checkout-settings.use-cases.js';
import { GetAgentRulesUseCase, UpdateAgentRulesUseCase } from '../../../../agent-rules/application/agent-rules.use-cases.js';
import { GetStoreSettingsUseCase } from '../../../../store-settings/application/use-cases/get-store-settings.use-case.js';
import { UpdateStoreSettingsUseCase } from '../../../../store-settings/application/use-cases/update-store-settings.use-case.js';
import { GetSeoSettingsUseCase } from '../../../../store-settings/application/use-cases/get-seo-settings.use-case.js';
import { UpdateSeoSettingsUseCase } from '../../../../store-settings/application/use-cases/update-seo-settings.use-case.js';
import { SettingsEntityMapper } from '../../application/mappers/settings-entity.mapper.js';
import { CheckoutSettingsPatchDto } from '../../../../checkout-settings/presentation/http/checkout-settings.dto.js';
import { AgentRulesPatchDto } from '../../../../agent-rules/presentation/http/dto/agent-rules-patch.dto.js';
import { UpdateStoreSettingsDto } from '../../dtos/update-store-settings.dto.js';
import { UpdateSeoSettingsDto } from '../../dtos/update-seo-settings.dto.js';

/**
 * Public API v1 — Settings
 *
 * Unified resource controller for checkout settings and agent rules.
 * Consolidates configuration endpoints under /v1/settings.
 *
 * Auth: Bearer API key (service) or session cookie (human/dashboard).
 * Tenant: Automatically scoped by TenantCredentialGuard + TenantAccessGuard.
 */
@ApiTags('Settings')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@Controller('settings')
@UseInterceptors(ResponseEnvelopeInterceptor)
export class SettingsV1Controller {
  constructor(
    private readonly getCheckoutSettings: GetCheckoutSettingsUseCase,
    private readonly updateCheckoutSettings: UpdateCheckoutSettingsUseCase,
    private readonly getAgentRules: GetAgentRulesUseCase,
    private readonly updateAgentRules: UpdateAgentRulesUseCase,
    private readonly getStoreSettings: GetStoreSettingsUseCase,
    private readonly updateStoreSettings: UpdateStoreSettingsUseCase,
    private readonly getSeoSettings: GetSeoSettingsUseCase,
    private readonly updateSeoSettings: UpdateSeoSettingsUseCase,
    private readonly entityTags: EntityTagService,
  ) {}

  /**
   * GET /v1/settings/checkout
   * Retrieve checkout configuration for the merchant.
   */
  @Get('checkout')
  @ApiOperation({ summary: 'Get checkout configuration' })
  @ApiOkResponse({ description: 'Checkout configuration retrieved with ETag header' })
  @ApiResponse({ status: 403, description: 'Missing configuration:read scope' })
  @RequireTenantAccess({ serviceScopes: ['configuration:read'] })
  async getCheckout(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const settings = await this.getCheckoutSettings.execute(merchantId);

    // Set ETag header for optimistic concurrency on PUT
    this.entityTags.set(response, settings);

    return SettingsEntityMapper.toCheckoutSettingsResponse(settings);
  }

  /**
   * PUT /v1/settings/checkout
   * Update checkout configuration with optimistic concurrency via ETag.
   */
  @Put('checkout')
  @Idempotent()
  @ApiOperation({ summary: 'Update checkout configuration' })
  @ApiOkResponse({ description: 'Configuration updated; new ETag in response header' })
  @ApiResponse({ status: 400, description: 'Invalid settings fields' })
  @ApiResponse({ status: 403, description: 'Missing configuration:write scope' })
  @ApiResponse({ status: 412, description: 'ETag mismatch — concurrent modification detected' })
  @RequireTenantAccess({ serviceScopes: ['configuration:write'] })
  async updateCheckout(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    body: CheckoutSettingsPatchDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const current = await this.getCheckoutSettings.execute(merchantId);

    // Enforce If-Match header for optimistic concurrency
    this.entityTags.assertIfMatch(ifMatch, current);

    const updated = await this.updateCheckoutSettings.execute(
      merchantId,
      body as unknown as CheckoutSettingsPatch,
      current.updatedAt,
    );

    this.entityTags.set(response, updated);
    return SettingsEntityMapper.toCheckoutSettingsResponse(updated);
  }

  /**
   * GET /v1/settings/agent-rules
   * Retrieve agent rules configuration for the merchant.
   */
  @Get('agent-rules')
  @ApiOperation({ summary: 'Get agent rules configuration' })
  @ApiOkResponse({ description: 'Agent rules configuration retrieved with ETag header' })
  @ApiResponse({ status: 403, description: 'Missing configuration:read scope' })
  @RequireTenantAccess({ serviceScopes: ['configuration:read'] })
  async getAgentRulesConfig(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const rules = await this.getAgentRules.execute({ merchantId });

    // Set ETag header for optimistic concurrency on PUT
    this.entityTags.set(response, rules);

    return SettingsEntityMapper.toAgentRulesResponse(rules);
  }

  /**
   * PUT /v1/settings/agent-rules
   * Update agent rules configuration with optimistic concurrency via ETag.
   */
  @Put('agent-rules')
  @Idempotent()
  @ApiOperation({ summary: 'Update agent rules configuration' })
  @ApiOkResponse({ description: 'Configuration updated; new ETag in response header' })
  @ApiResponse({ status: 400, description: 'Invalid agent rules fields' })
  @ApiResponse({ status: 403, description: 'Missing configuration:write scope' })
  @ApiResponse({ status: 412, description: 'ETag mismatch — concurrent modification detected' })
  @RequireTenantAccess({ serviceScopes: ['configuration:write'] })
  async updateAgentRulesConfig(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    body: AgentRulesPatchDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const current = await this.getAgentRules.execute({ merchantId });

    // Enforce If-Match header for optimistic concurrency
    this.entityTags.assertIfMatch(ifMatch, current);

    const updated = await this.updateAgentRules.execute(
      { merchantId },
      body as unknown as AgentRulesPatch,
    );

    this.entityTags.set(response, updated);
    return SettingsEntityMapper.toAgentRulesResponse(updated);
  }

  /**
   * GET /v1/settings/store
   * Retrieve store configuration for the merchant.
   */
  @Get('store')
  @ApiOperation({ summary: 'Get store configuration' })
  @ApiOkResponse({ description: 'Store configuration retrieved with ETag header' })
  @ApiResponse({ status: 403, description: 'Missing configuration:read scope' })
  @RequireTenantAccess({ serviceScopes: ['configuration:read'] })
  async getStore(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const settings = await this.getStoreSettings.execute(merchantId);

    // Set ETag header for optimistic concurrency on PUT
    this.entityTags.set(response, settings);

    return SettingsEntityMapper.toStoreSettingsResponse(settings);
  }

  /**
   * PUT /v1/settings/store
   * Update store configuration with optimistic concurrency via ETag.
   */
  @Put('store')
  @Idempotent()
  @ApiOperation({ summary: 'Update store configuration' })
  @ApiOkResponse({ description: 'Configuration updated; new ETag in response header' })
  @ApiResponse({ status: 400, description: 'Invalid store settings fields' })
  @ApiResponse({ status: 403, description: 'Missing configuration:write scope' })
  @ApiResponse({ status: 412, description: 'ETag mismatch — concurrent modification detected' })
  @RequireTenantAccess({ serviceScopes: ['configuration:write'] })
  async updateStore(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    body: UpdateStoreSettingsDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const current = await this.getStoreSettings.execute(merchantId);

    // Enforce If-Match header for optimistic concurrency
    this.entityTags.assertIfMatch(ifMatch, current);

    const updated = await this.updateStoreSettings.execute(
      merchantId,
      { ...current, ...body } as any,
    );

    this.entityTags.set(response, updated);
    return SettingsEntityMapper.toStoreSettingsResponse(updated);
  }

  /**
   * GET /v1/settings/seo
   * Retrieve SEO configuration for the merchant.
   */
  @Get('seo')
  @ApiOperation({ summary: 'Get SEO configuration' })
  @ApiOkResponse({ description: 'SEO configuration retrieved with ETag header' })
  @ApiResponse({ status: 403, description: 'Missing configuration:read scope' })
  @RequireTenantAccess({ serviceScopes: ['configuration:read'] })
  async getSeo(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const config = await this.getSeoSettings.execute(merchantId);

    // Set ETag header for optimistic concurrency on PUT
    this.entityTags.set(response, config);

    return SettingsEntityMapper.toSeoSettingsResponse(config);
  }

  /**
   * PUT /v1/settings/seo
   * Update SEO configuration with optimistic concurrency via ETag.
   */
  @Put('seo')
  @Idempotent()
  @ApiOperation({ summary: 'Update SEO configuration' })
  @ApiOkResponse({ description: 'Configuration updated; new ETag in response header' })
  @ApiResponse({ status: 400, description: 'Invalid SEO settings fields' })
  @ApiResponse({ status: 403, description: 'Missing configuration:write scope' })
  @ApiResponse({ status: 412, description: 'ETag mismatch — concurrent modification detected' })
  @RequireTenantAccess({ serviceScopes: ['configuration:write'] })
  async updateSeo(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    body: UpdateSeoSettingsDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const current = await this.getSeoSettings.execute(merchantId);

    // Enforce If-Match header for optimistic concurrency
    this.entityTags.assertIfMatch(ifMatch, current);

    const updated = await this.updateSeoSettings.execute(
      merchantId,
      body as any,
    );

    this.entityTags.set(response, updated);
    return SettingsEntityMapper.toSeoSettingsResponse(updated);
  }
}
