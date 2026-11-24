import {randomUUID} from "node:crypto";
import {Body,Controller,Get,Headers,Inject,Optional,Param,Patch,Post,Query,Req,UseGuards} from "@nestjs/common";
import type {CreateProspectCampaignDraft,EditProspectCampaignDraft} from "@zyon/shared-types";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import {currentPlatformPrincipal,type PlatformPrincipalRequest} from "../../platform-control/presentation/platform-principal.js";
import {CampaignPreparation} from "../application/campaigns/campaign-preparation.js";
import {CampaignDraftService} from "../application/campaigns/campaign-drafts.js";
import {prospectingHttpError,requestCommand,requestKeys,requestText} from "./prospecting-http-error.js";
export const draftActor=(req:PlatformPrincipalRequest)=>({operatorId:currentPlatformPrincipal(req).operatorId,correlationId:randomUUID()});
export async function draftRespond<T>(run:()=>Promise<T>){try{return await run();}catch(e){prospectingHttpError(e);}}
@Controller("platform/prospecting/campaign-drafts") @UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
export class ProspectCampaignDraftController {
 constructor(@Inject(CampaignDraftService)private readonly drafts:CampaignDraftService,@Optional() @Inject(CampaignPreparation)private readonly preparation:CampaignPreparation){}
 @Get() list(@Query() q:Record<string,unknown>){return draftRespond(()=>{requestKeys(q,["cursor"]);return this.drafts.list(requestText(q.cursor,"cursor"));});}
 @Get(":id") detail(@Param("id")id:string){return draftRespond(()=>this.drafts.find(id));}
 @Post() @RequirePlatformPermissions("platform:prospecting:campaigns")
 create(@Body()b:unknown,@Headers("idempotency-key")k:string|undefined,@Req()req:PlatformPrincipalRequest){return draftRespond(()=>this.drafts.create(requestCommand<CreateProspectCampaignDraft>(b,k,["name","businessContext","companies"]),draftActor(req)));}
 @Post(":id/prepare") @RequirePlatformPermissions("platform:prospecting:campaigns")
 prepare(@Param("id")id:string,@Body()b:unknown,@Headers("idempotency-key")k:string|undefined,@Req()req:PlatformPrincipalRequest){return draftRespond(()=>this.preparation.prepare(id,requestCommand<{expectedRevision:number;clientRequestId:string;templateRegistryId?:string}>(b,k,["expectedRevision","templateRegistryId"]),draftActor(req)));}
 @Patch(":id") @RequirePlatformPermissions("platform:prospecting:campaigns")
 edit(@Param("id")id:string,@Body()b:unknown,@Headers("idempotency-key")k:string|undefined,@Req()req:PlatformPrincipalRequest){return draftRespond(()=>this.drafts.edit(id,requestCommand<EditProspectCampaignDraft>(b,k,["expectedRevision","name","businessContext","offerPolicy","message","templateRegistryId","senderBindingId","senderVersion","template","limits","sendWindow"]),draftActor(req)));}
}
