import {Body,Controller,Get,HttpCode,Inject,Param,Post,Put,Query,Req,UseFilters,UseGuards} from '@nestjs/common';
import type {MetaAdsApproveLaunchInput,MetaAdsCampaignNoticeContactInput,MetaAdsCampaignPreparationInput} from '@zyon/shared-types';
import {AuthGuard} from '../../auth/presentation/auth.guard.js';
import {InitialLaunchService} from '../application/initial-launch.service.js';
import {CampaignPreparationService} from '../application/campaign-preparation.service.js';
import {CampaignNoticeContactService} from '../application/campaign-notice-contact.service.js';
import {MetaAdsAgentService,publicProposal} from '../application/meta-ads-agent.service.js';
import {MetaAdsError} from '../domain/types.js';
import {MetaAdsHttpErrorFilter} from './meta-ads-agent.controller.js';
import {metaAdsMerchantPrincipal,type MetaAdsMerchantRequest} from './merchant-request.js';

@Controller('meta-ads-agent')
@UseGuards(AuthGuard)
@UseFilters(MetaAdsHttpErrorFilter)
export class CampaignApprovalController{
  constructor(@Inject(InitialLaunchService) private readonly launches:InitialLaunchService,
    @Inject(CampaignPreparationService) private readonly preparations:CampaignPreparationService,
    @Inject(CampaignNoticeContactService) private readonly contacts:CampaignNoticeContactService,
    @Inject(MetaAdsAgentService) private readonly meta:MetaAdsAgentService){}
  private principal(request:MetaAdsMerchantRequest,mutation=false){return metaAdsMerchantPrincipal(request,this.meta.env.META_ADS_DASHBOARD_URL,mutation);}
  @Get('campaign-notice-contact')
  contact(@Req() request:MetaAdsMerchantRequest,@Query() query:Record<string,unknown>){
    const p=this.principal(request);if(Object.keys(query).length)throw new MetaAdsError('request_fields_invalid');
    return this.contacts.read(p.tenantId,p.userId);
  }
  @Put('campaign-notice-contact')
  saveContact(@Req() request:MetaAdsMerchantRequest,@Body() body:MetaAdsCampaignNoticeContactInput){
    const p=this.principal(request,true);return this.contacts.save(p.tenantId,p.userId,body);
  }
  @Get('campaigns/:id/launch-review')
  async review(@Req() request:MetaAdsMerchantRequest,@Param('id') id:string,@Query() query:Record<string,unknown>){
    const p=this.principal(request);
    if(Object.keys(query).some(key=>key!=='proposal')||query.proposal!==undefined&&typeof query.proposal!=='string')throw new MetaAdsError('request_fields_invalid');
    const view=await this.launches.review(p.tenantId,p.userId,id,query.proposal as string|undefined);
    return{...view,proposal:publicProposal(view.proposal)};
  }
  @Get('campaigns/:id/preparation')
  preparation(@Req() request:MetaAdsMerchantRequest,@Param('id') id:string,@Query() query:Record<string,unknown>){
    const p=this.principal(request);if(Object.keys(query).length)throw new MetaAdsError('request_fields_invalid');
    return this.preparations.read(p.tenantId,p.userId,id);
  }
  @Post('campaigns/:id/preparation') @HttpCode(202)
  prepare(@Req() request:MetaAdsMerchantRequest,@Param('id') id:string,@Body() body:MetaAdsCampaignPreparationInput){
    const p=this.principal(request,true);return this.preparations.request(p.tenantId,p.userId,id,body);
  }
  @Post('campaigns/:id/proposals/:proposalId/approve-launch') @HttpCode(202)
  async approveLaunch(@Req() request:MetaAdsMerchantRequest,@Param('id') id:string,@Param('proposalId') proposalId:string,@Body() body:MetaAdsApproveLaunchInput){
    const p=this.principal(request,true),view=await this.launches.approveAndLaunch(p.tenantId,p.userId,id,proposalId,body);
    return{...view,proposal:publicProposal(view.proposal)};
  }
}
