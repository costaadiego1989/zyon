import {Body,Controller,Get,Headers,HttpCode,Inject,Param,Post,Req,UseGuards} from "@nestjs/common";
import type {PrepareCampaignContext} from "@zyon/shared-types";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import type {PlatformPrincipalRequest} from "../../platform-control/presentation/platform-principal.js";
import {CampaignPlanner} from "../application/campaigns/campaign-planner.js";
import {draftActor,draftRespond} from "./prospect-campaign-draft.controller.js";
import {requestCommand} from "./prospecting-http-error.js";
@Controller("platform/prospecting/campaign-drafts/:id/context-preparations") @UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
export class ProspectCampaignPlannerController {
 constructor(@Inject(CampaignPlanner)private readonly planner:CampaignPlanner){}
 @Post() @HttpCode(202) @RequirePlatformPermissions("platform:prospecting:campaigns")
 prepare(@Param("id")id:string,@Body()b:unknown,@Headers("idempotency-key")k:string|undefined,@Req()req:PlatformPrincipalRequest){return draftRespond(()=>this.planner.prepare(id,requestCommand<PrepareCampaignContext>(b,k,["expectedRevision","snapshotId"]),draftActor(req)));}
 @Get(":jobId") poll(@Param("id")id:string,@Param("jobId")jobId:string){return draftRespond(()=>this.planner.poll(id,jobId));}
}
