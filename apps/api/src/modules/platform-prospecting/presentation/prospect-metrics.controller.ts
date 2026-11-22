import {Controller,Get,Inject,Query,UseGuards} from "@nestjs/common";
import {BILLING_PLANS,type PlatformSenderReadiness} from "@zyon/shared-types";
import {PlatformAccessGuard} from "../../platform-control/presentation/platform-access.guard.js";
import {PlatformPermissionGuard} from "../../platform-control/presentation/platform-permission.guard.js";
import {RequirePlatformPermissions} from "../../platform-control/presentation/platform-permission.decorator.js";
import type {PlatformSalesOffers} from "../../payment/public-platform-sales-offers.js";
import {ProspectMetricsQueryService} from "../application/crm/prospect-metrics.query.js";
import {prospectingHttpError,requestKeys,requestText} from "./prospecting-http-error.js";

interface Runtime {moduleEnabled:boolean; workersRunning:boolean; dispatchMode:"disabled"|"controlled"|"live"; modelMode:"disabled"|"controlled"|"live"; ingestionEnabled:boolean}
interface Source {snapshotId:string|null;competence:string|null;state:string}
interface Knowledge {activePublications:number}
type Channel=Pick<PlatformSenderReadiness,"binding"|"blockers"|"status"|"updatedAt">;
interface Operations {source():Promise<Source>; knowledge():Promise<Knowledge>; channel():Promise<Channel>; runtime():Runtime}
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
 constructor(private readonly ops:Operations,private readonly catalog:Pick<PlatformSalesOffers,"current"|"publicSite">){}
 config() {
  const {moduleEnabled,workersRunning,dispatchMode,modelMode,ingestionEnabled}=this.ops.runtime();
  return {moduleEnabled,workersRunning,dispatchMode,modelMode,ingestionEnabled,reservationDayTimezone:"UTC" as const};
 }
 async readiness() {
  const [source,knowledge,channel]=await Promise.all([
   this.directory.read(async()=>{const {snapshotId,competence,state}=await this.ops.source();return {snapshotId,competence,state};},v=>!!v.snapshotId&&v.state==="published"),
   this.publications.read(async()=>({activePublications:(await this.ops.knowledge()).activePublications})),
   this.sender.read(async()=>{const s=await this.ops.channel();return {status:s.status,blockers:s.blockers,bindingId:s.binding?.id??null,bindingVersion:s.binding?.version??null,updatedAt:s.updatedAt};},v=>v.status!=="unknown")
  ]);
  return {source,knowledge,channel,runtime:this.config(),updatedAt:new Date().toISOString()};
 }
 async offers(){return {items:await Promise.all(Object.keys(BILLING_PLANS).map(k=>this.catalog.current(k))),siteUrl:this.catalog.publicSite()};}
}
@Controller("platform/prospecting")
@UseGuards(PlatformAccessGuard,PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
export class ProspectMetricsController {
 constructor(@Inject(ProspectMetricsQueryService)private readonly metrics:ProspectMetricsQueryService,
  @Inject(ProspectOperationalStatus)private readonly status:ProspectOperationalStatus){}
 @Get("metrics") async funnel(@Query() q:Record<string,unknown>){
  try{requestKeys(q,["campaignId","from","to"]);return await this.metrics.execute({campaignId:requestText(q.campaignId,"campaignId"),from:requestText(q.from,"from",40)??"",to:requestText(q.to,"to",40)??""});}catch(e){prospectingHttpError(e);}
 }
 @Get("readiness") async readiness(@Query() q:Record<string,unknown>){try{requestKeys(q,[]);return await this.status.readiness();}catch(e){prospectingHttpError(e);}}
 @Get("config") config(@Query() q:Record<string,unknown>){try{requestKeys(q,[]);return this.status.config();}catch(e){prospectingHttpError(e);}}
 @Get("offers") async offers(@Query() q:Record<string,unknown>){try{requestKeys(q,[]);return await this.status.offers();}catch(e){prospectingHttpError(e);}}
}
