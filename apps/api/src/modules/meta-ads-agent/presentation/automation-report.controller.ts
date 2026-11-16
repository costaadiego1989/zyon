import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/presentation/auth.guard.js';
import { AutomationPolicyService } from '../application/automation-policy.service.js';
import { MetaAdsAgentService } from '../application/meta-ads-agent.service.js';
import { DAILY_OBSERVATION_REPOSITORY, type DailyObservationRepository } from '../domain/daily-observation.port.js';
import { MetaAdsError } from '../domain/types.js';
import { requireIdentifier } from '../domain/offer.js';
import { MetaAdsHttpErrorFilter } from './meta-ads-agent.controller.js';
import { metaAdsMerchantPrincipal, type MetaAdsMerchantRequest } from './merchant-request.js';

function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new MetaAdsError('request_fields_invalid');
}
@Controller('meta-ads-agent')
@UseGuards(AuthGuard)
@UseFilters(MetaAdsHttpErrorFilter)
export class AutomationReportController {
  constructor(@Inject(AutomationPolicyService) private readonly policies: AutomationPolicyService,
    @Inject(DAILY_OBSERVATION_REPOSITORY) private readonly daily: DailyObservationRepository,
    @Inject(MetaAdsAgentService) private readonly meta: MetaAdsAgentService) {}
  private principal(request: MetaAdsMerchantRequest, mutation = false) { return metaAdsMerchantPrincipal(request, this.meta.env.META_ADS_DASHBOARD_URL, mutation); }
  @Get('automation') async state(@Req() request: MetaAdsMerchantRequest) {
    const { tenantId } = this.principal(request);
    const state = await this.meta.repo.read(tenantId);
    return { ...await this.policies.view(tenantId), version: state.automation?.version ?? 0 };
  }
  @Post('automation/review') @HttpCode(200)
  review(@Req() request: MetaAdsMerchantRequest, @Body() body: unknown) {
    const principal = this.principal(request, true); fields(body, ['scope', 'limits']);
    return this.policies.review(principal.tenantId, principal.userId, body);
  }
  @Post('automation/accept') @HttpCode(200)
  accept(@Req() request: MetaAdsMerchantRequest, @Body() body: unknown) {
    const principal = this.principal(request, true); fields(body, ['scope', 'limits', 'version', 'digest', 'idempotencyKey']);
    if (body.version === 0) throw new MetaAdsError('automation_policy_version_conflict', 409);
    return this.policies.accept(principal.tenantId, principal.userId, body as unknown as Parameters<AutomationPolicyService['accept']>[2]);
  }
  @Post('automation/manual') @HttpCode(200)
  manual(@Req() request: MetaAdsMerchantRequest, @Body() body: unknown) {
    const principal = this.principal(request, true); fields(body, ['policyId', 'version', 'idempotencyKey']);
    return this.policies.revoke(principal.tenantId, principal.userId, body as unknown as Parameters<AutomationPolicyService['revoke']>[2]);
  }
  @Get('reports') async reports(@Req() request: MetaAdsMerchantRequest, @Query() query: Record<string, unknown>) {
    const { tenantId } = this.principal(request); if (Object.keys(query).length) throw new MetaAdsError('request_fields_invalid');
    const accountId = (await this.meta.repo.read(tenantId)).connection.account?.id;
    const rows = accountId ? await this.daily.list(tenantId, accountId) : [];
    return { reports: rows.flatMap(row => row.report ? [row.report] : []) };
  }
  @Get('reports/:id') async report(@Req() request: MetaAdsMerchantRequest, @Param('id') id: string) {
    const { tenantId } = this.principal(request); requireIdentifier(id);
    const row = await this.daily.read(tenantId, id); if (!row.report) throw new MetaAdsError('daily_report_not_ready', 409);
    return row.report;
  }
}
