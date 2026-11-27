import {randomUUID} from "node:crypto";
import {Body,Controller,Get,Headers,HttpCode,Inject,Param,Post,Query,Req,UseGuards} from "@nestjs/common";
import type {ChangeProspectOwnership,SendProspectMessage} from "@zyon/shared-types";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import {currentPlatformPrincipal,type PlatformPrincipalRequest} from "../../platform-control/presentation/platform-principal.js";
import {ProspectConversationService} from "../application/conversations/prospect-conversation.service.js";
import {prospectingHttpError,requestCommand,requestKeys,requestLimit,requestText} from "./prospecting-http-error.js";

const actor=(req:PlatformPrincipalRequest)=>({operatorId:currentPlatformPrincipal(req).operatorId,correlationId:randomUUID()});
async function respond<T>(run:()=>Promise<T>){try{return await run();}catch(error){prospectingHttpError(error);}}
export function sequenceParam(value:unknown){
 if(value===undefined)return undefined;if(typeof value!=="string"||!/^\d{1,10}$/.test(value)||Number(value)>2147483647)throw Error("invalid_filter:sequence");return Number(value);
}
export function pageSize(value:unknown){const n=requestLimit(value)??50;if(n<1||n>100)throw Error("invalid_filter:limit");return n;}
@Controller("platform/prospecting/conversations") @UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
export class ProspectConversationController{
 constructor(@Inject(ProspectConversationService)private readonly service:ProspectConversationService){}
 @Get() list(@Query() q:Record<string,unknown>,@Req() req:PlatformPrincipalRequest){
  return respond(()=>{requestKeys(q,["cursor","limit","unread","assignedOperatorId","campaignId","search"]);if(q.unread!==undefined&&!["true","false"].includes(String(q.unread)))throw Error("invalid_filter:unread");
   return this.service.repository.list({cursor:requestText(q.cursor,"cursor"),limit:pageSize(q.limit),unread:q.unread==="true",assignedOperatorId:requestText(q.assignedOperatorId,"assignedOperatorId"),campaignId:requestText(q.campaignId,"campaignId"),search:requestText(q.search,"search")},actor(req));});
 }
 @Get(":id") history(@Param("id") id:string,@Query() q:Record<string,unknown>,@Req() req:PlatformPrincipalRequest){
  return respond(()=>{requestKeys(q,["before","after","limit"]);if(q.before!==undefined&&q.after!==undefined)throw Error("invalid_filter:pagination");
   return this.service.repository.history(id,{before:sequenceParam(q.before),after:sequenceParam(q.after),limit:pageSize(q.limit)},actor(req));});
 }
 @Get(":id/changes")
 changes(@Param("id") id:string,@Query() q:Record<string,unknown>){
  return respond(()=>{requestKeys(q,["after","limit"]);return this.service.repository.changes(id,sequenceParam(q.after)??0,pageSize(q.limit));});
 }
 @Get(":id/notes") @RequirePlatformPermissions("platform:prospecting:write")
 notes(@Param("id") id:string,@Query() q:Record<string,unknown>){
  return respond(()=>{requestKeys(q,["cursor","limit"]);return this.service.repository.notes(id,requestText(q.cursor,"cursor"),pageSize(q.limit));});
 }
 @Post(":id/notes") @RequirePlatformPermissions("platform:prospecting:write")
 addNote(@Param("id") id:string,@Body() b:unknown,@Headers("idempotency-key") k:string|undefined,@Req() req:PlatformPrincipalRequest){
  return respond(()=>this.service.addNote(id,requestCommand(b,k,["content"]),actor(req)));
 }
 @Post(":id/ownership") @HttpCode(200) @RequirePlatformPermissions("platform:prospecting:write")
 ownership(@Param("id") id:string,@Body() b:unknown,@Headers("idempotency-key") k:string|undefined,@Req() req:PlatformPrincipalRequest){
  return respond(()=>this.service.ownership(id,requestCommand<ChangeProspectOwnership>(b,k,["expectedEpoch","action"]),actor(req)));
 }
 @Post(":id/messages") @HttpCode(202) @RequirePlatformPermissions("platform:prospecting:send")
 send(@Param("id") id:string,@Body() b:unknown,@Headers("idempotency-key") k:string|undefined,@Req() req:PlatformPrincipalRequest){
  return respond(()=>this.service.prepareManual(id,requestCommand<SendProspectMessage>(b,k,["expectedEpoch","content"]),actor(req)));
 }
 @Post(":id/read") @HttpCode(200)
 read(@Param("id") id:string,@Body() b:unknown,@Headers("idempotency-key") k:string|undefined,@Req() req:PlatformPrincipalRequest){
  return respond(()=>this.service.markRead(id,requestCommand(b,k,["sequence"]),actor(req)));
 }
}
