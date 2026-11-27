import type {ChangeCampaignCompanies,CampaignCompanyChangeResult,CampaignCompanyPage} from "@zyon/shared-types";
import type {ProspectingActor} from "../../domain/prospecting.ports.js";
import {companyReferences} from "./campaign-drafts.js";
import {prospectVersion} from "../crm/prospect.service.js";
import {canonicalCnpj} from "../../domain/company-directory/cnpj.js";
export interface CampaignDraftAudienceStore {
 change(id:string,cmd:ChangeCampaignCompanies,actor:ProspectingActor,remove:boolean):Promise<CampaignCompanyChangeResult>;
 list(id:string,after?:string):Promise<CampaignCompanyPage>;
}
export class CampaignDraftAudience {
 constructor(private readonly store:CampaignDraftAudienceStore){}
 async append(id:string,c:ChangeCampaignCompanies,a:ProspectingActor){prospectVersion(c.expectedRevision);return this.store.change(id,{...c,...companyReferences({snapshotId:c.snapshotId,cnpjs:c.cnpjs})},a,false);}
 async remove(id:string,c:ChangeCampaignCompanies,a:ProspectingActor){prospectVersion(c.expectedRevision);return this.store.change(id,{...c,...companyReferences({snapshotId:c.snapshotId,cnpjs:c.cnpjs})},a,true);}
 list(id:string,after?:string){return this.store.list(id,after?canonicalCnpj(after):undefined);}
}
