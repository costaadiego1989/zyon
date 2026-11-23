import {Body,Controller,Get,Inject,Put,Query,Req,UseFilters,UseGuards} from '@nestjs/common';
import type {MetaAdsPreparationLimitsInput} from '@zyon/shared-types';
import {AuthGuard} from '../../auth/presentation/auth.guard.js';
import {PreparationLimitsService} from '../application/preparation-limits.service.js';
import {MetaAdsAgentService} from '../application/meta-ads-agent.service.js';
import {MetaAdsError} from '../domain/types.js';
import {MetaAdsHttpErrorFilter} from './meta-ads-agent.controller.js';
import {metaAdsMerchantPrincipal,type MetaAdsMerchantRequest} from './merchant-request.js';
@Controller('meta-ads-agent') @UseGuards(AuthGuard) @UseFilters(MetaAdsHttpErrorFilter)
export class PreparationLimitsController {
 constructor(@Inject(PreparationLimitsService) private readonly limits:PreparationLimitsService,@Inject(MetaAdsAgentService) private readonly meta:MetaAdsAgentService){}
 @Get('preparation-limits')
 view(@Req() request:MetaAdsMerchantRequest,@Query() query:Record<string,unknown>){const p=metaAdsMerchantPrincipal(request,this.meta.env.META_ADS_DASHBOARD_URL);if(Object.keys(query).length)throw new MetaAdsError('request_fields_invalid');return this.limits.view(p.tenantId);}
 @Put('preparation-limits')
 update(@Req() request:MetaAdsMerchantRequest,@Body() body:MetaAdsPreparationLimitsInput){const p=metaAdsMerchantPrincipal(request,this.meta.env.META_ADS_DASHBOARD_URL,true);return this.limits.update(p.tenantId,p.userId,body);}
}
