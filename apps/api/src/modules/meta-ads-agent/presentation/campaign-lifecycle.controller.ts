import {Body,Controller,HttpCode,Inject,Param,Post,Req,UseFilters,UseGuards} from '@nestjs/common';
import type {MetaAdsCampaignLifecycleInput} from '@zyon/shared-types';
import {AuthGuard} from '../../auth/presentation/auth.guard.js';
import {CampaignLifecycleService} from '../application/campaign-lifecycle.service.js';
import {MetaAdsAgentService} from '../application/meta-ads-agent.service.js';
import {MetaAdsHttpErrorFilter} from './meta-ads-agent.controller.js';
import {metaAdsMerchantPrincipal,type MetaAdsMerchantRequest} from './merchant-request.js';

@Controller('meta-ads-agent') @UseGuards(AuthGuard) @UseFilters(MetaAdsHttpErrorFilter)
export class CampaignLifecycleController {
 constructor(@Inject(CampaignLifecycleService) private readonly lifecycle:CampaignLifecycleService,@Inject(MetaAdsAgentService) private readonly meta:MetaAdsAgentService){}
 @Post('campaigns/:id/delete-draft') @HttpCode(200)
 deleteDraft(@Req() request:MetaAdsMerchantRequest,@Param('id') id:string,@Body() body:MetaAdsCampaignLifecycleInput){const p=metaAdsMerchantPrincipal(request,this.meta.env.META_ADS_DASHBOARD_URL,true);return this.lifecycle.deleteDraft(p.tenantId,p.userId,id,body);}
 @Post('campaigns/:id/archive') @HttpCode(200)
 archive(@Req() request:MetaAdsMerchantRequest,@Param('id') id:string,@Body() body:MetaAdsCampaignLifecycleInput){const p=metaAdsMerchantPrincipal(request,this.meta.env.META_ADS_DASHBOARD_URL,true);return this.lifecycle.archive(p.tenantId,p.userId,id,body);}
}
