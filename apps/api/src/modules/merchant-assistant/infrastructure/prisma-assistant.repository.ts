import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient,type MerchantAssistantThread,type MerchantAssistantTurn} from '@prisma/client';
import type {AssistantCampaignProgress,AssistantTurnStatus} from '@zyon/shared-types';
import {AssistantError,validateAssistantScope,type AssistantScope,type AssistantRepository,type AssistantTransaction,
  type StoredAssistantThread,type StoredAssistantTurn,type NewAssistantTurn,type AssistantTurnPatch} from '../domain/assistant.port.js';

const json=(value:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(value));
function threadOf(row:MerchantAssistantThread):StoredAssistantThread{
  return {...row,campaignProgress:row.campaignProgress as unknown as AssistantCampaignProgress|null,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
function turnOf(row:MerchantAssistantTurn):StoredAssistantTurn{
  return {...row,status:row.status as AssistantTurnStatus,references:row.references as unknown as StoredAssistantTurn['references'],
    artifacts:row.artifacts as unknown as StoredAssistantTurn['artifacts'],budgetState:row.budgetState as StoredAssistantTurn['budgetState'],
    providerRequests:row.providerRequests as unknown as StoredAssistantTurn['providerRequests'],
    leaseUntil:row.leaseUntil?.toISOString()??null,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
function pageLimit(value:number){if(!Number.isInteger(value)||value<1||value>100)throw new AssistantError('assistant_page_invalid');return value;}

class ThreadTransaction implements AssistantTransaction {
  constructor(private readonly db:Prisma.TransactionClient,readonly thread:StoredAssistantThread,private readonly now:()=>Date){}
  private where(){return {merchantId:this.thread.merchantId,threadId:this.thread.id};}
  async request(requestKey:string){const row=await this.db.merchantAssistantTurn.findFirst({where:{...this.where(),requestKey}});return row?turnOf(row):null;}
  async turn(id:string){const row=await this.db.merchantAssistantTurn.findFirst({where:{...this.where(),id}});return row?turnOf(row):null;}
  async active(){const row=await this.db.merchantAssistantTurn.findFirst({where:{...this.where(),status:{in:['queued','running','unknown']}},orderBy:{ordinal:'desc'}});return row?turnOf(row):null;}
  async committedCostSince(since:Date){
    const [row]=await this.db.$queryRaw<Array<{amount:bigint}>>`
      SELECT COALESCE(sum(CASE WHEN budget_state IN ('reserved','dispatched','unknown') THEN GREATEST(budget_amount_micros,COALESCE(usage_cost_micros,0))
        WHEN budget_state='settled' AND created_at>=${since} THEN COALESCE(usage_cost_micros,budget_amount_micros) ELSE 0 END),0)::bigint AS amount
      FROM merchant_assistant_turns WHERE merchant_id=${this.thread.merchantId}`;
    return row?.amount??0n;
  }
  async append(input:NewAssistantTurn){
    const now=this.now();
    const row=await this.db.merchantAssistantTurn.create({data:{...input,merchantId:this.thread.merchantId,threadId:this.thread.id,
      ordinal:this.thread.revision+1,budgetState:'reserved',createdAt:now,updatedAt:now}});
    await this.db.merchantAssistantThread.update({where:{id:this.thread.id},data:{revision:{increment:1},updatedAt:now}});
    this.thread.revision++;this.thread.updatedAt=now.toISOString();return turnOf(row);
  }
  async update(id:string,patch:AssistantTurnPatch){
    if(!await this.turn(id))throw new AssistantError('assistant_turn_not_found',404);
    const {references,artifacts,providerRequests,leaseUntil,...scalar}=patch;
    const row=await this.db.merchantAssistantTurn.update({where:{id,...this.where()},data:{...scalar,updatedAt:this.now(),
      ...(references===undefined?{}:{references:json(references)}),...(artifacts===undefined?{}:{artifacts:json(artifacts)}),
      ...(providerRequests===undefined?{}:{providerRequests:json(providerRequests)}),
      ...(leaseUntil===undefined?{}:{leaseUntil:leaseUntil===null?null:new Date(leaseUntil)})}});
    return turnOf(row);
  }
  async setProgress(progress:AssistantCampaignProgress|null){
    const now=this.now();
    await this.db.merchantAssistantThread.update({where:{id:this.thread.id},data:{campaignProgress:progress===null?Prisma.DbNull:json(progress),updatedAt:now}});
    this.thread.campaignProgress=progress;this.thread.updatedAt=now.toISOString();
  }
}

export class PrismaAssistantRepository implements AssistantRepository {
  constructor(private readonly db:PrismaClient,private readonly now:()=>Date=()=>new Date()){}
  async createThread(scope:AssistantScope):Promise<StoredAssistantThread>{
    validateAssistantScope(scope);
    try{
      await this.db.$executeRaw`INSERT INTO merchant_assistant_threads(id,merchant_id,actor_id,context,created_at,updated_at)
        VALUES(${randomUUID()},${scope.merchantId},${scope.actorId},${scope.context},${this.now()},${this.now()})
        ON CONFLICT(merchant_id,actor_id,context) DO NOTHING`;
      const row=await this.db.merchantAssistantThread.findUnique({where:{merchantId_actorId_context:scope}});
      if(!row)throw new AssistantError('assistant_scope_not_found',404);return threadOf(row);
    }catch(error){const known=error as {code?:string;meta?:{code?:string}};
      if(known.code==='P2003'||known.code==='P2010'&&known.meta?.code==='23503')throw new AssistantError('assistant_scope_not_found',404);throw error;}
  }
  async readThread(scope:AssistantScope,id:string):Promise<StoredAssistantThread>{
    validateAssistantScope(scope);const row=await this.db.merchantAssistantThread.findFirst({where:{id,...scope}});
    if(!row)throw new AssistantError('assistant_thread_not_found',404);return threadOf(row);
  }
  async turns(scope:AssistantScope,id:string,{limit=30,before}:{limit?:number;before?:number}={}){
    pageLimit(limit);if(before!==undefined&&(!Number.isSafeInteger(before)||before<1))throw new AssistantError('assistant_page_invalid');
    await this.readThread(scope,id);
    const rows=await this.db.merchantAssistantTurn.findMany({where:{threadId:id,merchantId:scope.merchantId,...(before===undefined?{}:{ordinal:{lt:before}})},orderBy:{ordinal:'desc'},take:limit+1});
    const more=rows.length>limit;const selected=rows.slice(0,limit);
    return {turns:selected.reverse().map(turnOf),nextCursor:more?String(selected[0].ordinal):null};
  }
  async atomic<T>(scope:AssistantScope,id:string,work:(tx:AssistantTransaction)=>Promise<T>):Promise<T>{
    validateAssistantScope(scope);
    return this.db.$transaction(async db=>{
      // A per-merchant lock protects cost admission across threads. No external calls belong in work.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'merchant-assistant:'+scope.merchantId},0))::text`;
      const rows=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM merchant_assistant_threads WHERE id=${id} AND merchant_id=${scope.merchantId} AND actor_id=${scope.actorId} AND context=${scope.context} FOR UPDATE`;
      if(!rows.length)throw new AssistantError('assistant_thread_not_found',404);
      const row=await db.merchantAssistantThread.findUniqueOrThrow({where:{id}});
      return work(new ThreadTransaction(db,threadOf(row),this.now));
    },{maxWait:20000,timeout:20000});
  }
  async pending(now:Date,limit=100){
    pageLimit(limit);
    const rows=await this.db.merchantAssistantTurn.findMany({where:{OR:[{status:'queued'},{status:'running',leaseUntil:{lt:now}}]},
      orderBy:[{createdAt:'asc'},{id:'asc'}],take:limit,include:{thread:{select:{actorId:true,context:true}}}});
    return rows.map(row=>({scope:{merchantId:row.merchantId,actorId:row.thread.actorId,context:row.thread.context},threadId:row.threadId,turnId:row.id}));
  }
}
