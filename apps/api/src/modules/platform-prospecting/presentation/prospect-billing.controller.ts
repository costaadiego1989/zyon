import {Body,Controller,ForbiddenException,Headers,HttpCode,Inject,NotFoundException,Param,Post,Req,UseGuards} from "@nestjs/common";
import {randomUUID} from "node:crypto";
import {AuthGuard,currentUser} from "../../auth/presentation/auth.guard.js";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import {currentPlatformPrincipal,type PlatformPrincipalRequest} from "../../platform-control/presentation/platform-principal.js";
import {PROSPECTING_PORTS,type ProspectBillingPort} from "../domain/prospecting.ports.js";
import {prospectingHttpError,requestKeys,requestCommand} from "./prospecting-http-error.js";

@Controller("platform/prospecting/prospects")
@UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:write")
export class ProspectBillingProposalController{
 constructor(@Inject(PROSPECTING_PORTS.billing) private readonly bridge:ProspectBillingPort){}
 @Post(":id/billing-proposal") async create(@Param("id") id:string,@Body() body:unknown,@Headers("idempotency-key") key:string|undefined,@Req() req:PlatformPrincipalRequest){
  try{const cmd=requestCommand<{planKey:string;clientRequestId:string}>(body,key,["planKey"]);return await this.bridge.createSignupProposal(id,cmd.planKey,cmd.clientRequestId,{operatorId:currentPlatformPrincipal(req).operatorId,correlationId:randomUUID()});}
  catch(e){prospectingHttpError(e);}
 }
}
@Controller("billing/prospect-proposal") @UseGuards(AuthGuard)
export class ProspectAccountBindingController{
 constructor(@Inject(PROSPECTING_PORTS.billing) private readonly bridge:ProspectBillingPort){}
 @Post("bind") @HttpCode(200) async bind(@Body() body:Record<string,unknown>,@Req() req:{user?:unknown}){
  try{if(!body||typeof body!=="object"||Array.isArray(body))throw Error("invalid_proposal_token");requestKeys(body,["token"]);if(typeof body.token!=="string")throw Error("invalid_proposal_token");
   const u=currentUser(req);return await this.bridge.bindAuthenticatedAccount(body.token,u.merchantId,u.userId);
  }catch(e){if(e instanceof Error&&e.message==="account_authority_required")throw new ForbiddenException(e.message);if(e instanceof Error&&e.message==="proposal_not_found")throw new NotFoundException(e.message);prospectingHttpError(e);}
 }
}
