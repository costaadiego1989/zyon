import type {AssistantCampaignProgress,AssistantTurn} from '@zyon/shared-types';

export class AssistantError extends Error {
  constructor(public readonly code:string,public readonly status=400){super(code);this.name='AssistantError';}
}
export interface AssistantScope {merchantId:string;actorId:string;context:string;}
export function validateAssistantScope(scope:AssistantScope):void{
  if(!scope||[scope.merchantId,scope.actorId,scope.context].some(value=>typeof value!=='string'||value!==value.trim()||!/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,199}$/.test(value)))
    throw new AssistantError('assistant_scope_invalid',403);
}
export interface StoredAssistantThread {
  id:string;merchantId:string;actorId:string;context:string;revision:number;
  campaignProgress:AssistantCampaignProgress|null;createdAt:string;updatedAt:string;
}
export interface AssistantProviderAttempt {
  key:string;kind:'model'|'generation'|'meta';status:'sending'|'completed'|'rejected'|'unknown';
  providerRequestId?:string;operationId?:string;
}
export type AssistantBudgetState='none'|'reserved'|'dispatched'|'settled'|'released'|'unknown';
export interface StoredAssistantTurn extends AssistantTurn {
  merchantId:string;requestKey:string;inputHash:string;leaseToken:string|null;leaseUntil:string|null;
  budgetAmountMicros:bigint;budgetState:AssistantBudgetState;usageCostMicros:bigint|null;
  providerRequests:AssistantProviderAttempt[];
}
export interface NewAssistantTurn {id:string;requestKey:string;inputHash:string;message:string;budgetAmountMicros:bigint;}
export type AssistantTurnPatch=Partial<Pick<StoredAssistantTurn,'status'|'reply'|'references'|'artifacts'|'error'|'leaseToken'|'leaseUntil'|'budgetState'|'usageCostMicros'|'providerRequests'>>;
export interface AssistantTransaction {
  readonly thread:StoredAssistantThread;
  request(key:string):Promise<StoredAssistantTurn|null>;
  turn(id:string):Promise<StoredAssistantTurn|null>;
  active():Promise<StoredAssistantTurn|null>;
  committedCostSince(since:Date):Promise<bigint>;
  append(input:NewAssistantTurn):Promise<StoredAssistantTurn>;
  update(id:string,patch:AssistantTurnPatch):Promise<StoredAssistantTurn>;
  setProgress(progress:AssistantCampaignProgress|null):Promise<void>;
}
export interface AssistantRepository {
  createThread(scope:AssistantScope):Promise<StoredAssistantThread>;
  readThread(scope:AssistantScope,id:string):Promise<StoredAssistantThread>;
  turns(scope:AssistantScope,id:string,page?:{limit?:number;before?:number}):Promise<{turns:StoredAssistantTurn[];nextCursor:string|null}>;
  atomic<T>(scope:AssistantScope,id:string,work:(tx:AssistantTransaction)=>Promise<T>):Promise<T>;
  pending(now:Date,limit:number):Promise<Array<{scope:AssistantScope;threadId:string;turnId:string}>>;
}
