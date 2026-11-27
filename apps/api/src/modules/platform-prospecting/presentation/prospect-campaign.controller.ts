import {randomUUID} from "node:crypto";
import {Body,Controller,Get,Headers,HttpCode,Inject,Param,Patch,Post,Query,Req,UseGuards} from "@nestjs/common";
import type {ApproveProspectCampaign,FreezeCampaignAudience as FreezeCommand,ProspectCampaignAction,SaveProspectCampaign} from "@zyon/shared-types";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import {currentPlatformPrincipal,type PlatformPrincipalRequest} from "../../platform-control/presentation/platform-principal.js";
import {CampaignService} from "../application/campaigns/campaign.service.js";
import {FreezeCampaignAudience} from "../application/campaigns/freeze-campaign-audience.js";
import {prospectingHttpError,requestCommand,requestKeys,requestText} from "./prospecting-http-error.js";
const fields=["name","message","planKey","senderBindingId","senderVersion","limits","sendWindow","template"];
const actor=(req:PlatformPrincipalRequest)=>({operatorId:currentPlatformPrincipal(req).operatorId,correlationId:randomUUID()});
async function respond<T>(run:()=>Promise<T>){try{return await run();}catch(e){prospectingHttpError(e);}}
@Controller("platform/prospecting/campaigns") @UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
export class ProspectCampaignController {
 constructor(@Inject(CampaignService)private readonly campaigns:CampaignService,@Inject(FreezeCampaignAudience)private readonly audience:FreezeCampaignAudience){}
 @Get() list(@Query() query:Record<string,unknown>){return respond(()=>{requestKeys(query,["cursor"]);return this.campaigns.list(requestText(query.cursor,"cursor"));});}
 @Get(":id") detail(@Param("id") id:string){return respond(()=>this.campaigns.find(id));}
 @Get(":id/recipients") recipients(@Param("id")id:string,@Query() q:Record<string,unknown>){return respond(()=>{requestKeys(q,["cursor"]);return this.campaigns.recipients(id,requestText(q.cursor,"cursor"));});}
 @Get(":id/selections/:selection") poll(@Param("id") id:string,@Param("selection") selection:string){return respond(async()=>{const job=await this.audience.poll(selection);if(!job||job.campaignId!==id)throw new Error("selection_not_found");return job;});}
 @Post() @RequirePlatformPermissions("platform:prospecting:campaigns")
 create(@Body() b:unknown,@Headers("idempotency-key") k:string|undefined,@Req() req:PlatformPrincipalRequest){
  return respond(()=>this.campaigns.create(requestCommand<SaveProspectCampaign>(b,k,fields),actor(req)));
 }
 @Patch(":id") @RequirePlatformPermissions("platform:prospecting:campaigns")
 revise(@Param("id") id:string,@Body() b:unknown,@Headers("idempotency-key") k:string|undefined,@Req() req:PlatformPrincipalRequest){
  return respond(()=>this.campaigns.revise(id,requestCommand<SaveProspectCampaign>(b,k,[...fields,"expectedRevision"]),actor(req)));
 }
 @Post(":id/freeze") @HttpCode(202) @RequirePlatformPermissions("platform:prospecting:campaigns")
 freeze(@Param("id") id:string,@Body() b:unknown,@Headers("idempotency-key") k:string|undefined,@Req() req:PlatformPrincipalRequest){
  return respond(()=>this.audience.enqueue(id,requestCommand<FreezeCommand>(b,k,["expectedRevision","snapshotId","segmentId","segmentVersion","cnpjs"]),actor(req)));
 }
 @Post(":id/approve") @HttpCode(200) @RequirePlatformPermissions("platform:prospecting:campaigns")
 approve(@Param("id") id:string,@Body() b:unknown,@Headers("idempotency-key") k:string|undefined,@Req() req:PlatformPrincipalRequest){
  return respond(()=>this.campaigns.approve(id,requestCommand<ApproveProspectCampaign>(b,k,["expectedRevision","audienceHash","contentHash"]),actor(req)));
 }
 @Post(":id/start") @HttpCode(202) @RequirePlatformPermissions("platform:prospecting:send")
 start(@Param("id") id:string,@Body() b:unknown,@Headers("idempotency-key") k:string|undefined,@Req() req:PlatformPrincipalRequest){
  return respond(()=>this.campaigns.action(id,{...requestCommand<Omit<ProspectCampaignAction,"action">>(b,k,["expectedRevision"]),action:"start"},actor(req)));
 }
 @Post(":id/pause-or-resume") @HttpCode(200) @RequirePlatformPermissions("platform:prospecting:campaigns")
 pauseOrResume(@Param("id") id:string,@Body() b:unknown,@Headers("idempotency-key") k:string|undefined,@Req() req:PlatformPrincipalRequest){
  return respond(()=>{const c=requestCommand<ProspectCampaignAction>(b,k,["action","expectedRevision"]);if(c.action!=="pause"&&c.action!=="resume")throw new Error("invalid_command:action");return this.campaigns.action(id,c,actor(req));});
 }
}
