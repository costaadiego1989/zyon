import type {Clock,MetaAdsRepository} from '../domain/types.js';
import {MetaAdsError} from '../domain/types.js';
import type {CampaignOpportunityService} from '../application/campaign-opportunity.service.js';
interface Dependencies {repo:MetaAdsRepository;opportunities:Pick<CampaignOpportunityService,'evaluate'>;enabled():boolean;clock?:Clock}
/** The reservation and the model's durable turn make multiple pollers safe. */
export class CampaignOpportunityWorker {
 private active:Promise<void>|undefined;private timer:ReturnType<typeof setInterval>|undefined;private stopping=false;private readonly clock:Clock;
 constructor(private readonly deps:Dependencies){this.clock=deps.clock??(()=>new Date());}
 onModuleInit(){if(this.deps.enabled()){this.timer=setInterval(()=>{void this.drain();},30000);this.timer.unref();void this.drain();}}
 async onModuleDestroy(){this.stopping=true;clearInterval(this.timer);await this.active;}
 drain():Promise<void>{if(this.stopping||!this.deps.enabled())return Promise.resolve();return this.active??=this.run().finally(()=>{this.active=undefined;});}
 private async run(){let after:string|undefined;while(!this.stopping&&this.deps.enabled()){
  const stores=await this.deps.repo.listStoreIds(100,after);for(const merchantId of stores){if(this.stopping||!this.deps.enabled())return;
   try{
    const claimed=await this.deps.repo.mutate(merchantId,[],state=>{const version=state.automation?.version??0;if(!state.automation?.activePolicyId||state.opportunityEvaluation?.policyVersion===version&&Date.parse(state.opportunityEvaluation.nextAt)>this.clock().getTime())return{result:false};state.opportunityEvaluation={policyVersion:version,nextAt:new Date(this.clock().getTime()+300000).toISOString(),lastError:null};return{result:true};});
    if(!claimed)continue;try{await this.deps.opportunities.evaluate(merchantId);}catch(error){await this.deps.repo.mutate(merchantId,[],state=>{if(state.opportunityEvaluation)state.opportunityEvaluation.lastError=error instanceof MetaAdsError?error.code:'opportunity_evaluation_unavailable';return{result:null};});}
   }catch{/* One store cannot block another store or authorize a retry. */}
  }if(stores.length<100)return;after=stores.at(-1);
 }}
}
