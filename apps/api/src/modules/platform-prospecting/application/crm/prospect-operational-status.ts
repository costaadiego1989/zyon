import { BILLING_PLANS, type PlatformSenderReadiness, type CompanyDirectoryCoverage, type CompanyDirectoryImportSummary } from "@zyon/shared-types";
import type { CanonicalBillingOfferPort } from "../../domain/prospecting.ports.js";

interface Runtime {moduleEnabled:boolean; workersRunning:boolean; dispatchMode:"disabled"|"controlled"|"live"; modelMode:"disabled"|"controlled"|"live"; ingestionEnabled:boolean}
interface Source {snapshotId:string|null;competence:string|null;state:string;coverage?:unknown;latestImport?:unknown}
interface Knowledge {activePublications:number}
type Channel=Pick<PlatformSenderReadiness,"binding"|"blockers"|"status"|"updatedAt">;
interface Operations {source():Promise<Source>; knowledge():Promise<Knowledge>; channel():Promise<Channel>; runtime():Runtime}
const number=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):0;
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
function sourceValue(raw:Source){
 const {snapshotId,competence,state}=raw,value:{snapshotId:string|null;competence:string|null;state:string;coverage?:CompanyDirectoryCoverage;latestImport?:CompanyDirectoryImportSummary}={snapshotId,competence,state};
 const c=object(raw.coverage),p=object(raw.latestImport);
 if(c.kind==="regional_retail"&&Array.isArray(c.ufs)&&c.ufs.every(u=>typeof u==="string"&&/^(SP|RJ|MG|ES|PR|SC|RS)$/.test(u))&&Array.isArray(c.mainCnaes)&&c.mainCnaes.every(n=>typeof n==="string"&&/^\d{7}$/.test(n)))
  value.coverage={kind:"regional_retail",ufs:c.ufs,mainCnaes:c.mainCnaes,companyCount:number(c.companyCount),maximumDirectoryBytes:number(c.maximumDirectoryBytes),scopeComplete:c.scopeComplete===true};
 if(typeof p.id==="string"&&["discovered","importing","validating","ready","published","failed"].includes(String(p.state))&&typeof p.updatedAt==="string"&&Number.isFinite(Date.parse(p.updatedAt))){
  const phases=["starting","downloading","validating_sources","source_validated","reusing_entities","loading_missing_entities","prepared","reclaiming_staging","persisting_entities","persisting_establishments","persisting_domains","publishing","completed","failed"];
  const errors=["production_directory_storage_limit","retail_directory_25gb_limit","production_storage_measurement_unavailable","source_unavailable","source_changed","archive_disk_limit","archive_corrupt","recovery_missing_entities","import_superseded","operator_stopped"];
  value.latestImport={id:p.id,state:String(p.state),phase:phases.includes(String(p.phase))?String(p.phase):null,committedCount:number(p.committedCount),selectedCompanies:number(p.selectedCompanies),validatedFiles:number(p.validatedFiles),totalFiles:number(p.totalFiles),errorCode:p.errorCode==null?null:errors.includes(String(p.errorCode))?String(p.errorCode):"import_failed",updatedAt:p.updatedAt};
 }
 return value;
}
class Observation<T> {
 private last:{value:T;observedAt:string}|null=null;
 async read(load:()=>Promise<T>,healthy:(v:T)=>boolean=()=>true) {
  try {
   const value=await load();
   if(healthy(value)){this.last={value,observedAt:new Date().toISOString()};return {status:"current" as const,...this.last};}
   if(!this.last)return {status:"unavailable" as const,value,observedAt:null};
  }catch{ /* A failed observation retains the last successful public snapshot. */ }
  return this.last?{status:"stale" as const,...this.last}:{status:"unavailable" as const,value:null,observedAt:null};
 }
}
export class ProspectOperationalStatus {
 private readonly directory=new Observation<Source>();
 private readonly publications=new Observation<Knowledge>();
 private readonly sender=new Observation<{status:Channel["status"];blockers:Channel["blockers"];bindingId:string|null;bindingVersion:number|null;updatedAt:string}>();
 constructor(private readonly ops:Operations,private readonly catalog:Pick<CanonicalBillingOfferPort,"current"|"publicSite">){}
 config() {
  const {moduleEnabled,workersRunning,dispatchMode,modelMode,ingestionEnabled}=this.ops.runtime();
  return {moduleEnabled,workersRunning,dispatchMode,modelMode,ingestionEnabled,reservationDayTimezone:"UTC" as const};
 }
 async readiness() {
  const [source,knowledge,channel]=await Promise.all([
   this.directory.read(async()=>sourceValue(await this.ops.source()),v=>!!v.snapshotId&&v.state==="published"),
   this.publications.read(async()=>({activePublications:(await this.ops.knowledge()).activePublications})),
   this.sender.read(async()=>{const s=await this.ops.channel();return {status:s.status,blockers:s.blockers,bindingId:s.binding?.id??null,bindingVersion:s.binding?.version??null,updatedAt:s.updatedAt};},v=>v.status!=="unknown")
  ]);
  return {source,knowledge,channel,runtime:this.config(),updatedAt:new Date().toISOString()};
 }
 async offers(){return {items:await Promise.all(Object.keys(BILLING_PLANS).map(k=>this.catalog.current(k))),siteUrl:this.catalog.publicSite?.()??null};}
}
