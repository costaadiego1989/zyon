import { Controller,Get,Inject,Query,Param,UseGuards } from "@nestjs/common";
import type { CompanyDirectoryPort } from "../domain/prospecting.ports.js";
import { PROSPECTING_PORTS } from "../domain/prospecting.ports.js";
import type { CompanyDomainQuery } from "@zyon/shared-types";
import { SearchCompaniesQuery } from "../application/company-directory/search-companies.query.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { prospectingHttpError,requestText,requestLimit,requestKeys } from "./prospecting-http-error.js";

@Controller("platform/prospecting/companies")
@UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
export class CompanyDirectoryController {
  constructor(@Inject(PROSPECTING_PORTS.directory) private readonly directory:CompanyDirectoryPort,@Inject(SearchCompaniesQuery) private readonly query:SearchCompaniesQuery){}
  @Get() async search(@Query() raw:Record<string,unknown>){
    try{requestKeys(raw,["filters","snapshotId","cursor","limit"]);let filters:unknown={};if(raw.filters!==undefined){if(typeof raw.filters!=="string"||raw.filters.length>40_000)throw new Error("invalid_filter:filters");try{filters=JSON.parse(raw.filters);}catch{throw new Error("invalid_filter:filters");}}
      return await this.query.execute({filters:filters as import("@zyon/shared-types").CompanyFilters,snapshotId:requestText(raw.snapshotId,"snapshotId"),cursor:requestText(raw.cursor,"cursor",4096),limit:requestLimit(raw.limit)});
    }catch(error){prospectingHttpError(error);}
  }
  @Get("domains") async domains(@Query() raw:Record<string,unknown>){
    try{requestKeys(raw,["kind","snapshotId","uf","search","afterCode","limit"]);return await this.directory.domains({kind:requestText(raw.kind,"kind") as CompanyDomainQuery["kind"],uf:requestText(raw.uf,"uf",2),snapshotId:requestText(raw.snapshotId,"snapshotId"),search:requestText(raw.search,"search"),afterCode:requestText(raw.afterCode,"afterCode",7),limit:requestLimit(raw.limit)});}catch(error){prospectingHttpError(error);}
  }
  @Get(":cnpj") async detail(@Param("cnpj") cnpj:string,@Query() raw:Record<string,unknown>){
    try{requestKeys(raw,["snapshotId"]);const company=await this.directory.find(cnpj,requestText(raw.snapshotId,"snapshotId"));if(!company)throw new Error("company_not_found");return company;}catch(error){prospectingHttpError(error);}
  }
}
