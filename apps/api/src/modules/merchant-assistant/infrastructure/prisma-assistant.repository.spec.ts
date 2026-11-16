import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assistantDatabase} from './__tests__/database.js';
import {PrismaAssistantRepository} from './prisma-assistant.repository.js';
const scope={merchantId:'store-a',actorId:'owner-a',context:'meta_ads'};
const input=(id:string)=>({id,requestKey:id,inputHash:'a'.repeat(64),message:`Mensagem ${id}`,budgetAmountMicros:100n});

test('ADAS-11 repository survives reconstruction with canonical message and campaign progress',async()=>{
  const db=await assistantDatabase();try{const repo=new PrismaAssistantRepository(db.prisma);
    const thread=await repo.createThread(scope);
    await repo.atomic(scope,thread.id,async tx=>{await tx.append(input('turn-1'));await tx.setProgress({campaignId:null,draft:{name:'Campanha real'},awaitingFields:['budget']});});
    const fresh=new PrismaAssistantRepository(db.prisma);
    assert.equal((await fresh.readThread(scope,thread.id)).campaignProgress?.draft.name,'Campanha real');
    const saved=(await fresh.turns(scope,thread.id)).turns[0];assert.equal(saved.message,'Mensagem turn-1');assert.equal(saved.status,'queued');assert.equal(saved.ordinal,1);
  }finally{await db.close();}
});
test('repository denies a thread for another store actor or module context',async()=>{
  const db=await assistantDatabase();try{const repo=new PrismaAssistantRepository(db.prisma),thread=await repo.createThread(scope);
    for(const other of [{...scope,merchantId:'store-b'},{...scope,actorId:'owner-b'},{...scope,context:'another_context'}]){
      await assert.rejects(repo.readThread(other,thread.id),{code:'assistant_thread_not_found'});
      await assert.rejects(repo.turns(other,thread.id),{code:'assistant_thread_not_found'});
      await assert.rejects(repo.atomic(other,thread.id,async()=>null),{code:'assistant_thread_not_found'});
    }
  }finally{await db.close();}
});
test('repository creates one thread per store actor and context under concurrency',async()=>{
  const db=await assistantDatabase();try{const repo=new PrismaAssistantRepository(db.prisma);
    const threads=await Promise.all(Array.from({length:8},()=>repo.createThread(scope)));
    assert.equal(new Set(threads.map(t=>t.id)).size,1);assert.equal((await db.sql.query('SELECT count(*) FROM merchant_assistant_threads')).rows[0].count,'1');
  }finally{await db.close();}
});
test('repository serializes revisions and rolls back failed callbacks',async()=>{
  const db=await assistantDatabase();try{const repo=new PrismaAssistantRepository(db.prisma),thread=await repo.createThread(scope);
    await Promise.all(Array.from({length:6},(_,i)=>repo.atomic(scope,thread.id,async tx=>{await tx.append(input(`turn-${i}`));})));
    assert.equal((await repo.readThread(scope,thread.id)).revision,6);
    assert.deepEqual((await repo.turns(scope,thread.id)).turns.map(t=>t.ordinal),[1,2,3,4,5,6]);
    await assert.rejects(repo.atomic(scope,thread.id,async tx=>{await tx.append(input('rolled-back'));throw new Error('rollback');}),/rollback/);
    assert.equal((await repo.readThread(scope,thread.id)).revision,6);assert.equal((await repo.turns(scope,thread.id)).turns.length,6);
  }finally{await db.close();}
});
test('repository paginates the latest messages without duplicate or missing ordinals',async()=>{
  const db=await assistantDatabase();try{const repo=new PrismaAssistantRepository(db.prisma),thread=await repo.createThread(scope);
    for(let n=1;n<=5;n++)await repo.atomic(scope,thread.id,async tx=>{await tx.append(input(`turn-${n}`));});
    const first=await repo.turns(scope,thread.id,{limit:2});assert.deepEqual(first.turns.map(t=>t.ordinal),[4,5]);assert.equal(first.nextCursor,'4');
    const second=await repo.turns(scope,thread.id,{limit:2,before:4});assert.deepEqual(second.turns.map(t=>t.ordinal),[2,3]);assert.equal(second.nextCursor,'2');
    const third=await repo.turns(scope,thread.id,{limit:2,before:2});assert.deepEqual(third.turns.map(t=>t.ordinal),[1]);assert.equal(third.nextCursor,null);
    await assert.rejects(repo.turns(scope,thread.id,{limit:101}),{code:'assistant_page_invalid'});
  }finally{await db.close();}
});
test('repository updates only a turn inside its locked thread and reads pending scopes',async()=>{
  const db=await assistantDatabase();try{const repo=new PrismaAssistantRepository(db.prisma),thread=await repo.createThread(scope),other=await repo.createThread({...scope,actorId:'owner-b'});
    await repo.atomic(scope,thread.id,async tx=>{await tx.append(input('turn-a'));await tx.update('turn-a',{status:'completed',reply:'Concluído',budgetState:'settled',usageCostMicros:40n});});
    await repo.atomic({...scope,actorId:'owner-b'},other.id,async tx=>{await tx.append(input('turn-b'));await assert.rejects(tx.update('turn-a',{reply:'wrong'}),{code:'assistant_turn_not_found'});});
    assert.equal((await repo.turns(scope,thread.id)).turns[0].reply,'Concluído');
    const pending=await repo.pending(new Date(),10);assert.equal(pending.length,1);assert.equal(pending[0].scope.actorId,'owner-b');assert.equal(pending[0].turnId,'turn-b');
  }finally{await db.close();}
});
test('ADAS-52 deletion removes conversation and private source references and blocks further retrieval',async()=>{
  const db=await assistantDatabase();try{const repo=new PrismaAssistantRepository(db.prisma),thread=await repo.createThread(scope);
    await repo.atomic(scope,thread.id,async tx=>{await tx.append(input('turn-a'));await tx.update('turn-a',{references:[{id:'private-a',version:'1',title:'Privado',url:'/private-a',reviewedAt:'2026-11-16',excerpt:'store-a'}]});});
    await db.sql.query(`DELETE FROM merchants WHERE id='store-a'`);
    await assert.rejects(repo.readThread(scope,thread.id),{code:'assistant_thread_not_found'});
    assert.equal((await db.sql.query('SELECT count(*) FROM merchant_assistant_turns')).rows[0].count,'0');assert.deepEqual(await repo.pending(new Date(),10),[]);
  }finally{await db.close();}
});
test('repository rejects invalid scope and handles a missing merchant without leaking a database error',async()=>{
  const db=await assistantDatabase();try{const repo=new PrismaAssistantRepository(db.prisma);
    await assert.rejects(repo.createThread({...scope,merchantId:'bad\n'}),{code:'assistant_scope_invalid'});
    await assert.rejects(repo.createThread({...scope,merchantId:'missing-store'}),{code:'assistant_scope_not_found'});
  }finally{await db.close();}
});
