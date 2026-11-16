import {createHash,randomUUID} from 'node:crypto';
import type {AssistantTurnInput} from '@zyon/shared-types';
import {AssistantError,validateAssistantScope,type AssistantRepository,type AssistantScope,type StoredAssistantTurn,type AssistantProviderAttempt} from '../domain/assistant.port.js';

export interface AssistantAiBudget {turnMicros:bigint;monthlyMicros:bigint;}
const keyValid=(value:unknown):value is string=>typeof value==='string'&&value===value.trim()&&/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,199}$/.test(value);
function validateInput(input:AssistantTurnInput):string{
  if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['message','idempotencyKey','expectedRevision'].includes(key)))throw new AssistantError('assistant_input_invalid');
  if(typeof input.message!=='string'||input.message.length>8000||!input.message.trim())throw new AssistantError('assistant_message_invalid');
  if(!keyValid(input.idempotencyKey))throw new AssistantError('assistant_request_key_invalid');
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw new AssistantError('assistant_revision_invalid');
  return input.message.trim();
}
function validateBudget(value:AssistantAiBudget){
  if(!value||typeof value.turnMicros!=='bigint'||typeof value.monthlyMicros!=='bigint'||value.turnMicros<=0n||value.monthlyMicros<=0n||
    value.turnMicros>9223372036854775807n||value.monthlyMicros>9223372036854775807n)throw new AssistantError('assistant_ai_budget_invalid',503);
}
function lease(turn:StoredAssistantTurn|null,token:string,now:Date):asserts turn is StoredAssistantTurn{
  if(!turn||turn.status!=='running'||!keyValid(token)||turn.leaseToken!==token||!turn.leaseUntil||new Date(turn.leaseUntil).getTime()<=now.getTime())
    throw new AssistantError('assistant_lease_lost',409);
}
export {lease as assertAssistantTurnLease};

export class TurnAdmissionService {
  constructor(private readonly repo:AssistantRepository,private readonly authorize:(scope:AssistantScope)=>Promise<void>,
    private readonly limits:(scope:AssistantScope)=>AssistantAiBudget|Promise<AssistantAiBudget>,private readonly clock:()=>Date=()=>new Date(),private readonly id:()=>string=randomUUID){}

  async submit(scope:AssistantScope,threadId:string,input:AssistantTurnInput){
    validateAssistantScope(scope);const message=validateInput(input);
    await this.authorize(scope);
    const budget=await this.limits(scope);validateBudget(budget);
    const hash=createHash('sha256').update(scope.context+'\0'+message).digest('hex');
    const now=this.clock(),month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
    return this.repo.atomic(scope,threadId,async tx=>{
      const prior=await tx.request(input.idempotencyKey);
      if(prior){if(prior.inputHash!==hash)throw new AssistantError('assistant_idempotency_conflict',409);return {turn:prior,revision:tx.thread.revision,replayed:true};}
      const active=await tx.active();
      if(active)throw new AssistantError(active.status==='unknown'?'assistant_outcome_unknown':'assistant_turn_pending',409);
      if(tx.thread.revision!==input.expectedRevision)throw new AssistantError('assistant_revision_conflict',409);
      if(await tx.committedCostSince(month)+budget.turnMicros>budget.monthlyMicros)throw new AssistantError('assistant_ai_budget_exhausted',429);
      const turn=await tx.append({id:this.id(),requestKey:input.idempotencyKey,inputHash:hash,message,budgetAmountMicros:budget.turnMicros});
      return {turn,revision:tx.thread.revision,replayed:false};
    });
  }

  async dispatched(scope:AssistantScope,threadId:string,turnId:string,token:string,operation:Pick<AssistantProviderAttempt,'key'|'kind'>){
    if(!operation||!keyValid(operation.key)||!['model','generation','meta'].includes(operation.kind))throw new AssistantError('assistant_operation_invalid');
    await this.authorize(scope);
    return this.repo.atomic(scope,threadId,async tx=>{
      const turn=await tx.turn(turnId);lease(turn,token,this.clock());
      if(turn.providerRequests.some(attempt=>attempt.key===operation.key))throw new AssistantError('assistant_operation_already_dispatched',409);
      if(!['reserved','dispatched'].includes(turn.budgetState))throw new AssistantError('assistant_budget_not_reserved',409);
      return tx.update(turnId,{budgetState:'dispatched',providerRequests:[...turn.providerRequests,{...operation,status:'sending'}]});
    });
  }

  async failed(scope:AssistantScope,threadId:string,turnId:string,token:string){
    return this.repo.atomic(scope,threadId,async tx=>{
      const turn=await tx.turn(turnId);
      if(turn&&['unknown','failed','completed'].includes(turn.status))return turn;
      lease(turn,token,this.clock());
      const unknown=turn.budgetState==='dispatched'||turn.providerRequests.some(attempt=>['sending','unknown'].includes(attempt.status));
      return tx.update(turnId,{status:unknown?'unknown':'failed',budgetState:unknown?'unknown':'released',
        providerRequests:turn.providerRequests.map(attempt=>attempt.status==='sending'?{...attempt,status:'unknown'}:attempt),
        error:unknown?'assistant_outcome_unknown':'assistant_call_failed',leaseToken:null,leaseUntil:null});
    });
  }
}
