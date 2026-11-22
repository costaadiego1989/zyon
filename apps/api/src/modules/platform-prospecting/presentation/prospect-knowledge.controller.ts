import {randomUUID} from "node:crypto";
import {Body,Controller,Get,Headers,HttpCode,Inject,NotFoundException,Param,Post,Req,UseGuards} from "@nestjs/common";
import type {PublishSalesKnowledge,SalesKnowledgeQuery,SalesKnowledgeAnswer,SaveSalesKnowledge,SalesKnowledgeSource} from "@zyon/shared-types";
import type {ProspectingActor,SalesKnowledgePort} from "../domain/prospecting.ports.js";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import {currentPlatformPrincipal,type PlatformPrincipalRequest} from "../../platform-control/presentation/platform-principal.js";
import {prospectingHttpError,requestCommand} from "./prospecting-http-error.js";

export const KNOWLEDGE_ADMIN=Symbol("ProspectKnowledgeAdmin");
interface KnowledgeAdmin {
  sources:Pick<SalesKnowledgePort,"list"|"find"> & {save(id:string,draft:SaveSalesKnowledge,actor:ProspectingActor):Promise<SalesKnowledgeSource>};
  publications:{publish(id:string,c:PublishSalesKnowledge,a:ProspectingActor):Promise<unknown>;withdraw(id:string,c:PublishSalesKnowledge,a:ProspectingActor):Promise<unknown>};
  query:Pick<SalesKnowledgePort,"queryPublishedKnowledge">;
}
@Controller("platform/prospecting/knowledge")
@UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:knowledge")
export class ProspectKnowledgeController {
  constructor(@Inject(KNOWLEDGE_ADMIN) private readonly admin:KnowledgeAdmin) {}
  private actor(req:PlatformPrincipalRequest){return {operatorId:currentPlatformPrincipal(req).operatorId,correlationId:randomUUID()};}
  @Get() async list(){try{return {items:await this.admin.sources.list()};}catch(e){prospectingHttpError(e);}}
  @Get(":id") async detail(@Param("id") id:string){
    try{const row=await this.admin.sources.find(id);if(!row)throw new NotFoundException("knowledge_not_found");return row;}catch(e){prospectingHttpError(e);}
  }
  @Post() async draft(@Body() body:unknown,@Headers("idempotency-key") key:string|undefined,@Req() req:PlatformPrincipalRequest){
    try{
      const {sourceId,...draft}=requestCommand<SaveSalesKnowledge & {sourceId:string}>(body,key,["sourceId","title","sourceRef","facts","validFrom","validUntil","expectedVersion"]);
      if(typeof sourceId!=="string")throw new Error("invalid_knowledge_source");
      return await this.admin.sources.save(sourceId,draft,this.actor(req));
    }catch(e){prospectingHttpError(e);}
  }
  @Post(":id/publish-or-withdraw") @HttpCode(200)
  async change(@Param("id") id:string,@Body() body:unknown,@Headers("idempotency-key") key:string|undefined,@Req() req:PlatformPrincipalRequest){
    try{
      const command=requestCommand<PublishSalesKnowledge>(body,key,["expectedVersion","action","contentHash"]);
      if(!["publish","withdraw"].includes(command.action) || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion<1 || typeof command.contentHash!=="string" || !/^[a-f0-9]{64}$/.test(command.contentHash)) throw new Error("invalid_knowledge_command");
      return await this.admin.publications[command.action](id,command,this.actor(req));
    }catch(e){if(e instanceof Error && e.message==="knowledge_not_found")throw new NotFoundException(e.message);prospectingHttpError(e);}
  }
  @Post("query") @HttpCode(200) async query(@Body() body:SalesKnowledgeQuery):Promise<SalesKnowledgeAnswer>{
    try{
      const facts=await this.admin.query.queryPublishedKnowledge(body,new Date());
      const sources=[...new Map(facts.map(f=>[f.publicationId,{id:f.sourceId,publicationId:f.publicationId,version:f.publicationVersion}])).values()];
      return {answer:facts.length?facts.map(f=>f.value).join("\n"):null,handoff:!facts.length,reason:facts.length?null:"knowledge_unavailable",callMode:"controlled",facts,sources,offer:null};
    }catch(e){prospectingHttpError(e);}
  }
}
