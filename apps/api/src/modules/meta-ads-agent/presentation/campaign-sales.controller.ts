import {Controller,Get,Inject,Param,Query,Req,UseFilters,UseGuards} from '@nestjs/common';
import {AuthGuard} from '../../auth/presentation/auth.guard.js';
import {CampaignSalesQueryService} from '../application/campaign-sales-query.service.js';
import {MetaAdsAgentService} from '../application/meta-ads-agent.service.js';
import {MetaAdsError} from '../domain/types.js';
import {MetaAdsHttpErrorFilter} from './meta-ads-agent.controller.js';
import {metaAdsMerchantPrincipal,type MetaAdsMerchantRequest} from './merchant-request.js';
@Controller('meta-ads-agent') @UseGuards(AuthGuard) @UseFilters(MetaAdsHttpErrorFilter)
export class CampaignSalesController {
 constructor(@Inject(CampaignSalesQueryService) private readonly sales:CampaignSalesQueryService,@Inject(MetaAdsAgentService) private readonly meta:MetaAdsAgentService){}
 @Get('campaigns/:id/sales')
 list(@Req() request:MetaAdsMerchantRequest,@Param('id') id:string,@Query() query:Record<string,unknown>){const p=metaAdsMerchantPrincipal(request,this.meta.env.META_ADS_DASHBOARD_URL);return this.sales.sales(p.tenantId,id,query);}
 @Get('orders/:id/ad-origin')
 orderOrigin(@Req() request:MetaAdsMerchantRequest,@Param('id') id:string,@Query() query:Record<string,unknown>){const p=metaAdsMerchantPrincipal(request,this.meta.env.META_ADS_DASHBOARD_URL);if(Object.keys(query).length)throw new MetaAdsError('request_fields_invalid');return this.sales.orderOrigin(p.tenantId,id);}
}
