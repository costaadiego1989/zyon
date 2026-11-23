import {Body,Controller,Get,Headers,Inject,Param,Post,Query,Req,UseGuards} from "@nestjs/common";
import type {ChangeCampaignCompanies} from "@zyon/shared-types";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import type {PlatformPrincipalRequest} from "../../platform-control/presentation/platform-principal.js";
import {CampaignDraftAudience} from "../application/campaigns/campaign-draft-audience.js";
import {draftActor,draftRespond} from "./prospect-campaign-draft.controller.js";
import {requestCommand,requestKeys,requestText} from "./prospecting-http-error.js";
@Controller("platform/prospecting/campaign-drafts/:id/companies") @UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
export class ProspectCampaignCompaniesController {
 constructor(@Inject(CampaignDraftAudience)private readonly audience:CampaignDraftAudience){}
 @Get() list(@Param("id")id:string,@Query()q:Record<string,unknown>){return draftRespond(()=>{requestKeys(q,["cursor"]);return this.audience.list(id,requestText(q.cursor,"cursor"));});}
 @Post() @RequirePlatformPermissions("platform:prospecting:campaigns")
 append(@Param("id")id:string,@Body()b:unknown,@Headers("idempotency-key")k:string|undefined,@Req()req:PlatformPrincipalRequest){return draftRespond(()=>this.audience.append(id,requestCommand<ChangeCampaignCompanies>(b,k,["expectedRevision","snapshotId","cnpjs"]),draftActor(req)));}
 @Post("remove") @RequirePlatformPermissions("platform:prospecting:campaigns")
 remove(@Param("id")id:string,@Body()b:unknown,@Headers("idempotency-key")k:string|undefined,@Req()req:PlatformPrincipalRequest){return draftRespond(()=>this.audience.remove(id,requestCommand<ChangeCampaignCompanies>(b,k,["expectedRevision","snapshotId","cnpjs"]),draftActor(req)));}
}
