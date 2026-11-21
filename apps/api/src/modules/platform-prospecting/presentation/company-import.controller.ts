import { randomUUID } from "node:crypto";
import { Controller,Get,Post,Inject,Param,Body,Req,Headers,HttpCode,UseGuards,BadRequestException } from "@nestjs/common";
import { CompanyImportService } from "../application/company-directory/company-import.service.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal,type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";
import { prospectingHttpError,requestKeys } from "./prospecting-http-error.js";
@Controller("platform/prospecting/imports")
@UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:admin")
export class CompanyImportController {
  constructor(@Inject(CompanyImportService) private readonly imports:CompanyImportService){}
  private command(body:unknown,key:string|undefined,keys:string[]):Record<string,string>{
    if(!body||typeof body!=="object"||Array.isArray(body))throw new BadRequestException("invalid_command");const input=body as Record<string,unknown>;requestKeys(input,keys);
    if(key!==undefined&&input.clientRequestId!==undefined&&key!==input.clientRequestId)throw new BadRequestException("invalid_command:clientRequestId");
    const clientRequestId=input.clientRequestId??key;if(typeof clientRequestId!=="string")throw new BadRequestException("invalid_command:clientRequestId");
    const output:Record<string,string>={clientRequestId};for(const [field,value]of Object.entries(input)){if(typeof value!=="string")throw new BadRequestException(`invalid_command:${field}`);output[field]=value;}return output;
  }
  @Get("competences") async competences(){try{return await this.imports.competences();}catch(error){prospectingHttpError(error);}}
  @Get("manifests/:competence") async manifest(@Param("competence") competence:string){try{return await this.imports.manifest(competence);}catch(error){prospectingHttpError(error);}}
  @Post() @HttpCode(202) async start(@Body() body:unknown,@Headers("idempotency-key") key:string|undefined,@Req() request:PlatformPrincipalRequest){
    try{const input=this.command(body,key,["clientRequestId","manifestId","competence"]);return await this.imports.start({clientRequestId:input.clientRequestId,manifestId:input.manifestId,competence:input.competence},{operatorId:currentPlatformPrincipal(request).operatorId,correlationId:randomUUID()});}catch(error){prospectingHttpError(error);}
  }
  @Get(":id") async status(@Param("id") id:string){try{return await this.imports.status(id);}catch(error){prospectingHttpError(error);}}
  @Post(":id/resume") @HttpCode(202) async resume(@Param("id") id:string,@Body() body:unknown,@Headers("idempotency-key") key:string|undefined,@Req() request:PlatformPrincipalRequest){
    try{const input=this.command(body,key,["clientRequestId"]);return await this.imports.resume(id,input.clientRequestId,{operatorId:currentPlatformPrincipal(request).operatorId,correlationId:randomUUID()});}catch(error){prospectingHttpError(error);}
  }
}
