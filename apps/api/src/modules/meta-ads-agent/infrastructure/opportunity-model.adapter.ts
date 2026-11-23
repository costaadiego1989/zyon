import {randomUUID} from 'node:crypto';
import type {OpportunityModelPort,TextModelUsage} from '../domain/types.js';
import {MetaAdsError} from '../domain/types.js';
import {requireIdentifier,stableDigest} from '../domain/offer.js';
import {AssistantError,type AssistantRepository,type AssistantScope,type StoredAssistantTurn} from '../../merchant-assistant/domain/assistant.port.js';
import type {AssistantModelPort,AssistantModelResult,AssistantToolDescriptor} from '../../merchant-assistant/domain/model.port.js';
import {assertAssistantTurnLease,type TurnAdmissionService} from '../../merchant-assistant/application/turn-admission.service.js';
interface Dependencies {repo:AssistantRepository;admission:TurnAdmissionService;model:AssistantModelPort;authorize(scope:AssistantScope):Promise<void>;asService<T>(scope:AssistantScope,work:()=>Promise<T>):Promise<T>;clock?:()=>Date}
type Input=Parameters<OpportunityModelPort['plan']>[0];
const evidenceFields=['stockQuantity','priceCents','paidUnits','netRevenueCents','adSpendCents','adPaidOrders','historicalCostCents'];
type Selection={variantId:string;headline:string;primaryText:string;evidenceFields:string[];quality:'observed'|'initial_test'};
export class OpportunityModelAdapter implements OpportunityModelPort {
 private readonly clock:()=>Date;
 constructor(private readonly deps:Dependencies){this.clock=deps.clock??(()=>new Date());}
 private tool(input:Input):AssistantToolDescriptor{return{name:'select_campaign_product',description:'Escolha um produto e os fatos que justificam um teste. Não publica nem autoriza ações.',inputSchema:{type:'object',additionalProperties:false,required:['variantId','headline','primaryText','evidenceFields'],properties:{variantId:{type:'string',enum:input.candidates.map(c=>c.product.variantId)},headline:{type:'string',maxLength:120},primaryText:{type:'string',maxLength:2200},evidenceFields:{type:'array',minItems:1,maxItems:7,items:{type:'string',enum:evidenceFields}}}}};}
 private normalize(result:AssistantModelResult,input:Input):Selection{
  const invalid=():never=>{throw new MetaAdsError('opportunity_model_invalid',502);};
  if(result.toolCalls.length!==1||result.toolCalls[0].name!=='select_campaign_product')return invalid();
  const a=result.toolCalls[0].args;if(Object.keys(a).length!==4||!['variantId','headline','primaryText','evidenceFields'].every(k=>Object.hasOwn(a,k)))return invalid();
  const fact=input.candidates.find(c=>c.product.variantId===a.variantId);
  if(!fact||typeof a.headline!=='string'||!a.headline.trim()||a.headline.length>120||typeof a.primaryText!=='string'||!a.primaryText.trim()||a.primaryText.length>2200||!Array.isArray(a.evidenceFields)||!a.evidenceFields.length||a.evidenceFields.length>7||new Set(a.evidenceFields).size!==a.evidenceFields.length)return invalid();
  const values:Record<string,unknown>={...fact,stockQuantity:fact.product.stockQuantity,priceCents:fact.product.priceCents};
  if(a.evidenceFields.some(field=>typeof field!=='string'||!evidenceFields.includes(field)||values[field]===null||values[field]===undefined))return invalid();
  return{variantId:fact.product.variantId,headline:a.headline.trim(),primaryText:a.primaryText.trim(),evidenceFields:a.evidenceFields as string[],quality:(fact.paidUnits??0)>0||(fact.adPaidOrders??0)>0?'observed':'initial_test'};
 }
 private result(turn:StoredAssistantTurn):Selection&{usage:TextModelUsage|null}{
  const request=turn.providerRequests.filter(p=>p.status==='completed'&&p.result?.usage).at(-1),usage=request?.result?.usage;
  return{...JSON.parse(turn.reply!) as Selection,usage:usage?{...usage,providerRequestId:request?.providerRequestId??null,costMicros:String(turn.usageCostMicros??0n),currency:'USD',costStatus:'estimated'}:null};
 }
 async plan(input:Input):ReturnType<OpportunityModelPort['plan']>{
  requireIdentifier(input.merchantId);requireIdentifier(input.actorId);requireIdentifier(input.planningKey);
  if(!input.candidates.length||input.candidates.length>10||new Set(input.candidates.map(c=>c.product.variantId)).size!==input.candidates.length)throw new MetaAdsError('opportunity_candidates_invalid');
  const scope:AssistantScope={merchantId:input.merchantId,actorId:'service:meta-ads-agent',context:`meta-ads-opportunity:${stableDigest(input.planningKey)}`};await this.deps.authorize(scope);
  const message=JSON.stringify({priority:input.priority,destination:input.destination,candidates:input.candidates.map(c=>({...c,product:{variantId:c.product.variantId,name:c.product.name.slice(0,200),description:c.product.description.slice(0,600),priceCents:c.product.priceCents,currency:c.product.currency,stockQuantity:c.product.stockQuantity}}))});
  const thread=await this.deps.repo.createThread(scope),admitted=await this.deps.admission.submit(scope,thread.id,{message,expectedRevision:thread.revision,idempotencyKey:input.planningKey});
  if(admitted.turn.status==='completed')return this.result(admitted.turn);
  if(admitted.turn.status==='unknown')throw new AssistantError('assistant_outcome_unknown',409);
  if(admitted.turn.status==='failed')throw new MetaAdsError('opportunity_model_invalid',502);
  const token=randomUUID();
  await this.deps.repo.atomic(scope,thread.id,async tx=>{const turn=(await tx.turn(admitted.turn.id))!;if(turn.status==='running'&&turn.leaseUntil&&Date.parse(turn.leaseUntil)>this.clock().getTime())throw new AssistantError('assistant_turn_pending',409);if(turn.providerRequests.some(p=>['sending','unknown'].includes(p.status))){await tx.update(turn.id,{status:'unknown',budgetState:'unknown',error:'assistant_outcome_unknown',leaseToken:null,leaseUntil:null});return;}await tx.update(turn.id,{status:'running',leaseToken:token,leaseUntil:new Date(this.clock().getTime()+120000).toISOString()});});
  const current=(await this.deps.repo.turns(scope,thread.id)).turns.find(t=>t.id===admitted.turn.id)!;if(current.status==='unknown')throw new AssistantError('assistant_outcome_unknown',409);
  return this.deps.asService(scope,async()=>{try{
   const result=await this.deps.model.complete({scope,threadId:thread.id,turnId:admitted.turn.id,leaseToken:token,step:0,purpose:'opportunity_planning',messages:[{role:'user',content:message}],knowledge:[],tools:[this.tool(input)]});
   const selection=this.normalize(result,input);
   const saved=await this.deps.repo.atomic(scope,thread.id,async tx=>{const turn=await tx.turn(admitted.turn.id);assertAssistantTurnLease(turn,token,this.clock());if(turn.providerRequests.some(p=>['sending','unknown'].includes(p.status)))throw new AssistantError('assistant_outcome_unknown',409);return tx.update(turn.id,{status:'completed',reply:JSON.stringify(selection),budgetState:'settled',usageCostMicros:turn.usageCostMicros??0n,leaseToken:null,leaseUntil:null});});
   return this.result(saved);
  }catch(error){try{await this.deps.admission.failed(scope,thread.id,admitted.turn.id,token,error instanceof AssistantError?error.code:undefined);}catch{/* Preserve durable paid result and unknown requests. */}throw error;}});
 }
}
