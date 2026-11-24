import {Controller,Get,Post,Inject,Param,Query,Req,UseFilters,UseGuards} from '@nestjs/common';
import {AuthGuard} from '../../auth/presentation/auth.guard.js';
import {CampaignWorkspaceQueryService} from '../application/campaign-workspace-query.service.js';
import {MetaAdsAgentService} from '../application/meta-ads-agent.service.js';
import {MetaAdsHttpErrorFilter} from './meta-ads-agent.controller.js';
import {metaAdsMerchantPrincipal,type MetaAdsMerchantRequest} from './merchant-request.js';

@Controller('meta-ads-agent') @UseGuards(AuthGuard) @UseFilters(MetaAdsHttpErrorFilter)
export class CampaignWorkspaceController {
 constructor(@Inject(CampaignWorkspaceQueryService) private readonly workspace:CampaignWorkspaceQueryService,@Inject(MetaAdsAgentService) private readonly meta:MetaAdsAgentService){}
 @Get('campaign-workspace')
 list(@Req() request:MetaAdsMerchantRequest,@Query() query:Record<string,unknown>){const p=metaAdsMerchantPrincipal(request,this.meta.env.META_ADS_DASHBOARD_URL);return this.workspace.list(p.tenantId,query);}
 @Get('campaign-workspace/:id')
 detail(@Req() request:MetaAdsMerchantRequest,@Param('id') id:string,@Query() query:Record<string,unknown>){const p=metaAdsMerchantPrincipal(request,this.meta.env.META_ADS_DASHBOARD_URL);return this.workspace.detail(p.tenantId,id,query);}
 @Post('campaign-workspace/:id/refresh')
 refresh(@Req() request:MetaAdsMerchantRequest,@Param('id') id:string,@Query() query:Record<string,unknown>){const p=metaAdsMerchantPrincipal(request,this.meta.env.META_ADS_DASHBOARD_URL);return this.workspace.refresh(p.tenantId,id,query);}
}
