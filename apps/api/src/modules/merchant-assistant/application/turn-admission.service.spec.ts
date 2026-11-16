import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assistantDatabase} from '../infrastructure/__tests__/database.js';
import {PrismaAssistantRepository} from '../infrastructure/prisma-assistant.repository.js';
import {TurnAdmissionService} from './turn-admission.service.js';
const scope={merchantId:'store-a',actorId:'owner-a',context:'meta_ads'};
async function fixture(monthlyMicros=1000n){
  const db=await assistantDatabase();let now=new Date('2026-11-16T12:00:00Z');const clock=()=>now;
  const repo=new PrismaAssistantRepository(db.prisma,clock);const thread=await repo.createThread(scope);
  const service=new TurnAdmissionService(repo,async()=>undefined,()=>({turnMicros:100n,monthlyMicros}),clock);
  const request=(key='request-a',message='Quero anunciar',expectedRevision=0)=>({idempotencyKey:key,message,expectedRevision});
  const claim=async(turnId:string)=>repo.atomic(scope,thread.id,async tx=>tx.update(turnId,{status:'running',leaseToken:'lease-a',leaseUntil:'2026-11-16T12:03:00Z'}));
  return {...db,repo,thread,service,request,claim,clock,setNow:(value:string)=>{now=new Date(value);}};
}
test('ADAS-14 identical retry returns the original turn and reserves only once',async()=>{
  const f=await fixture();try{
    const first=await f.service.submit(scope,f.thread.id,f.request());const again=await f.service.submit(scope,f.thread.id,f.request());
    assert.equal(again.turn.id,first.turn.id);assert.equal(again.revision,1);assert.equal(again.replayed,true);
    await assert.rejects(f.service.submit(scope,f.thread.id,f.request('request-a','Outro objetivo')),{code:'assistant_idempotency_conflict'});
    assert.equal((await f.repo.turns(scope,f.thread.id)).turns.length,1);
    assert.equal(await f.repo.atomic(scope,f.thread.id,tx=>tx.committedCostSince(new Date('2026-11-01'))),100n);
  }finally{await f.close();}
});
test('admission rejects stale revision and input over 8000 before persisting a turn',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.service.submit(scope,f.thread.id,f.request('stale','Oi',1)),{code:'assistant_revision_conflict'});
    await assert.rejects(f.service.submit(scope,f.thread.id,f.request('long','x'.repeat(8001))),{code:'assistant_message_invalid'});
    assert.equal((await f.repo.turns(scope,f.thread.id)).turns.length,0);
    const accepted=await f.service.submit(scope,f.thread.id,f.request('bound','x'.repeat(8000)));assert.equal(accepted.turn.message.length,8000);
  }finally{await f.close();}
});
test('simultaneous different requests admit only one active turn in a thread',async()=>{
  const f=await fixture();try{
    const results=await Promise.allSettled(Array.from({length:8},(_,i)=>f.service.submit(scope,f.thread.id,f.request(`request-${i}`))));
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    for(const result of results)if(result.status==='rejected')assert.equal(result.reason.code,'assistant_turn_pending');
    assert.equal((await f.repo.turns(scope,f.thread.id)).turns.length,1);
  }finally{await f.close();}
});
test('monthly AI budget is atomic across actors and independent between stores',async()=>{
  const f=await fixture(150n);try{
    const otherScope={...scope,actorId:'owner-b'},other=await f.repo.createThread(otherScope);
    const results=await Promise.allSettled([f.service.submit(scope,f.thread.id,f.request()),f.service.submit(otherScope,other.id,f.request())]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((results.find(x=>x.status==='rejected')as PromiseRejectedResult).reason.code,'assistant_ai_budget_exhausted');
    const storeB={...scope,merchantId:'store-b'},threadB=await f.repo.createThread(storeB);
    assert.equal((await f.service.submit(storeB,threadB.id,f.request())).turn.budgetAmountMicros,100n);
  }finally{await f.close();}
});
test('ADAS-50 timeout after dispatch preserves unknown reservation across calendar periods and prevents replay',async()=>{
  const f=await fixture(150n);try{const created=await f.service.submit(scope,f.thread.id,f.request());await f.claim(created.turn.id);
    await f.service.dispatched(scope,f.thread.id,created.turn.id,'lease-a',{key:'model-1',kind:'model'});
    const unknown=await f.service.failed(scope,f.thread.id,created.turn.id,'lease-a');assert.equal(unknown.status,'unknown');assert.equal(unknown.budgetState,'unknown');
    await f.sql.query(`UPDATE merchant_assistant_turns SET created_at='2026-10-01'`);
    const replay=await f.service.submit(scope,f.thread.id,f.request());assert.equal(replay.turn.id,created.turn.id);assert.equal(replay.turn.status,'unknown');
    const secondScope={...scope,actorId:'owner-b'},second=await f.repo.createThread(secondScope);
    await assert.rejects(f.service.submit(secondScope,second.id,f.request()),{code:'assistant_ai_budget_exhausted'});
    await assert.rejects(f.service.submit(scope,f.thread.id,f.request('next','Outro',1)),{code:'assistant_outcome_unknown'});
  }finally{await f.close();}
});
test('failure before dispatch releases its reservation and allows a new request',async()=>{
  const f=await fixture(100n);try{const first=await f.service.submit(scope,f.thread.id,f.request());await f.claim(first.turn.id);
    const failed=await f.service.failed(scope,f.thread.id,first.turn.id,'lease-a');assert.equal(failed.status,'failed');assert.equal(failed.budgetState,'released');
    const next=await f.service.submit(scope,f.thread.id,f.request('next','Novo objetivo',1));assert.equal(next.revision,2);assert.equal(next.turn.budgetState,'reserved');
  }finally{await f.close();}
});
test('dispatch rejects a different worker lease or an expired lease before sending',async()=>{
  const f=await fixture();try{const first=await f.service.submit(scope,f.thread.id,f.request());await f.claim(first.turn.id);
    await assert.rejects(f.service.dispatched(scope,f.thread.id,first.turn.id,'other',{key:'model-a',kind:'model'}),{code:'assistant_lease_lost'});
    f.setNow('2026-11-16T12:03:00Z');await assert.rejects(f.service.dispatched(scope,f.thread.id,first.turn.id,'lease-a',{key:'model-a',kind:'model'}),{code:'assistant_lease_lost'});
    const saved=(await f.repo.turns(scope,f.thread.id)).turns[0];assert.equal(saved.budgetState,'reserved');assert.deepEqual(saved.providerRequests,[]);
  }finally{await f.close();}
});
test('authorization denial happens before locking history and reading the AI budget',async()=>{
  const f=await fixture();try{let budgetReads=0,locks=0;const old=f.repo.atomic.bind(f.repo);f.repo.atomic=(...args:Parameters<typeof old>)=>{locks++;return old(...args);};
    const service=new TurnAdmissionService(f.repo,async()=>{throw Object.assign(new Error('denied'),{code:'assistant_context_forbidden'});},()=>{budgetReads++;return {turnMicros:1n,monthlyMicros:1n};},f.clock);
    await assert.rejects(service.submit(scope,f.thread.id,f.request()),{code:'assistant_context_forbidden'});assert.equal(locks,0);assert.equal(budgetReads,0);
  }finally{await f.close();}
});
test('admission rejects empty message and a malformed or reused dispatch key',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.service.submit(scope,f.thread.id,f.request('empty','   ')),{code:'assistant_message_invalid'});
    const turn=(await f.service.submit(scope,f.thread.id,f.request())).turn;await f.claim(turn.id);
    await assert.rejects(f.service.dispatched(scope,f.thread.id,turn.id,'lease-a',{key:'bad\n',kind:'model'}),{code:'assistant_operation_invalid'});
    await f.service.dispatched(scope,f.thread.id,turn.id,'lease-a',{key:'one',kind:'model'});
    await assert.rejects(f.service.dispatched(scope,f.thread.id,turn.id,'lease-a',{key:'one',kind:'model'}),{code:'assistant_operation_already_dispatched'});
    assert.equal((await f.repo.turns(scope,f.thread.id)).turns[0].providerRequests.length,1);
  }finally{await f.close();}
});
