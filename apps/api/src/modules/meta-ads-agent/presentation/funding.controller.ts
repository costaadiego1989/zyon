import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/presentation/auth.guard.js';
import { FundingService } from '../application/funding.service.js';
import { MetaAdsAgentService } from '../application/meta-ads-agent.service.js';
import { MetaAdsHttpErrorFilter } from './meta-ads-agent.controller.js';
import { emptyMetaRequest, metaAdsMerchantPrincipal, type MetaAdsMerchantRequest } from './merchant-request.js';

@Controller('meta-ads-agent/funding')
@UseGuards(AuthGuard)
@UseFilters(MetaAdsHttpErrorFilter)
export class FundingController {
  constructor(@Inject(FundingService) private readonly funding: FundingService, @Inject(MetaAdsAgentService) private readonly meta: MetaAdsAgentService) {}
  @Get() describe(@Req() request: MetaAdsMerchantRequest) {
    const principal = metaAdsMerchantPrincipal(request, this.meta.env.META_ADS_DASHBOARD_URL);
    return this.funding.describe(principal.tenantId);
  }
  @Post('refresh') @HttpCode(200)
  refresh(@Req() request: MetaAdsMerchantRequest, @Body() body: unknown) {
    const principal = metaAdsMerchantPrincipal(request, this.meta.env.META_ADS_DASHBOARD_URL, true); emptyMetaRequest(body);
    return this.funding.describe(principal.tenantId);
  }
}
