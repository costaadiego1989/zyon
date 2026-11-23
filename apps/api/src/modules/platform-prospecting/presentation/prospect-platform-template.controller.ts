import {Body,Controller,Get,Headers,Inject,Param,Post,Req,UseGuards} from "@nestjs/common";
import type {CreatePlatformProspectTemplate,SubmitPlatformProspectTemplate} from "@zyon/shared-types";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import type {PlatformPrincipalRequest} from "../../platform-control/presentation/platform-principal.js";
import {PlatformTemplateService} from "../application/campaigns/platform-template.service.js";
import {draftActor,draftRespond} from "./prospect-campaign-draft.controller.js";
import {requestCommand} from "./prospecting-http-error.js";
@Controller("platform/prospecting/sender/templates") @UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:admin")
export class ProspectPlatformTemplateController {
 constructor(@Inject(PlatformTemplateService)private readonly templates:PlatformTemplateService){}
 @Get() list(){return draftRespond(()=>this.templates.list());}
 @Get(":id") find(@Param("id")id:string){return draftRespond(()=>this.templates.find(id));}
 @Post() create(@Body()b:unknown,@Headers("idempotency-key")k:string|undefined,@Req()req:PlatformPrincipalRequest){return draftRespond(()=>this.templates.create(requestCommand<CreatePlatformProspectTemplate>(b,k,["name","language","body"]),draftActor(req)));}
 @Post(":id/submit") submit(@Param("id")id:string,@Body()b:unknown,@Headers("idempotency-key")k:string|undefined,@Req()req:PlatformPrincipalRequest){return draftRespond(()=>this.templates.submit(id,requestCommand<SubmitPlatformProspectTemplate>(b,k,["expectedRevision"]),draftActor(req)));}
 @Post(":id/sync") sync(@Param("id")id:string,@Body()b:unknown,@Headers("idempotency-key")k:string|undefined,@Req()req:PlatformPrincipalRequest){return draftRespond(()=>this.templates.sync(id,requestCommand<SubmitPlatformProspectTemplate>(b,k,["expectedRevision"]),draftActor(req)));}
}
