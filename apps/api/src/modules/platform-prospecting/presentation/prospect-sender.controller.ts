import {randomUUID} from "node:crypto";
import {Body,Controller,Get,Headers,Inject,Post,Req,UseGuards} from "@nestjs/common";
import type {ConnectPlatformSender,ProspectingCommand} from "@zyon/shared-types";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import {currentPlatformPrincipal,type PlatformPrincipalRequest} from "../../platform-control/presentation/platform-principal.js";
import {SenderReadinessService} from "../application/campaigns/sender-readiness.service.js";
import {PlatformSenderOnboardingService} from "../application/campaigns/platform-sender-onboarding.service.js";
import {prospectingHttpError,requestCommand} from "./prospecting-http-error.js";
const actor=(req:PlatformPrincipalRequest)=>({operatorId:currentPlatformPrincipal(req).operatorId,correlationId:randomUUID()});
@Controller("platform/prospecting/sender") @UseGuards(PlatformAccessGuard,PlatformPermissionGuard) @RequirePlatformPermissions("platform:prospecting:admin")
export class ProspectSenderController{
 constructor(@Inject(SenderReadinessService)private readonly health:SenderReadinessService,@Inject(PlatformSenderOnboardingService)private readonly onboarding:PlatformSenderOnboardingService){}
 @Get() async readiness(){try{return await this.health.readiness();}catch(e){prospectingHttpError(e);}}
 @Post("signup-state") async signup(@Body() b:unknown,@Headers("idempotency-key") key:string|undefined,@Req() req:PlatformPrincipalRequest){
  try{const cmd=requestCommand<ProspectingCommand>(b,key,[]);return await this.onboarding.signupState(actor(req),cmd.clientRequestId);}catch(e){prospectingHttpError(e);}
 }
 @Post("meta/connect") async connect(@Body() b:unknown,@Headers("idempotency-key") key:string|undefined,@Req() req:PlatformPrincipalRequest){
  try{return await this.onboarding.connect(requestCommand<ConnectPlatformSender>(b,key,["code","state","wabaId","phoneNumberId","businessId","messagingAccountIds","isOnBizApp"]),actor(req));}catch(e){prospectingHttpError(e);}
 }
}
