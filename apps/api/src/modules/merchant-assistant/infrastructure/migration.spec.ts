import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assistantDatabase} from './__tests__/database.js';
import {testDatabase} from '../../meta-ads-agent/infrastructure/__tests__/database.js';
import {readFile} from 'node:fs/promises';

async function thread(db:Awaited<ReturnType<typeof assistantDatabase>>,id='thread-a',merchant='store-a'){
  await db.sql.query(`INSERT INTO merchant_assistant_threads(id,merchant_id,actor_id,context) VALUES($1,$2,'owner-a','meta_ads')`,[id,merchant]);
}
async function turn(db:Awaited<ReturnType<typeof assistantDatabase>>,id='turn-a',merchant='store-a',threadId='thread-a',ordinal=1,key='request-a'){
  return db.sql.query(`INSERT INTO merchant_assistant_turns(id,merchant_id,thread_id,ordinal,request_key,input_hash,message) VALUES($1,$2,$3,$4,$5,$6,'Quero vender')`,[id,merchant,threadId,ordinal,key,'a'.repeat(64)]);
}
test('assistant migration preserves V1 records and store values',async()=>{
  const db=await assistantDatabase();try{
    const state={merchantId:'store-a',preserved:'canonical'};
    await db.sql.query(`INSERT INTO meta_ads_agent_stores(merchant_id,state,updated_at) VALUES('store-a',$1,now())`,[state]);
    await thread(db);await turn(db);
    assert.deepEqual((await db.sql.query(`SELECT state FROM meta_ads_agent_stores WHERE merchant_id='store-a'`)).rows[0].state,state);
  }finally{await db.close();}
});
test('assistant migration rejects a turn referring to a thread from another store',async()=>{
  const db=await assistantDatabase();try{await thread(db);await assert.rejects(turn(db,'bad','store-b'),(error:any)=>error.code==='23503');
    assert.equal((await db.sql.query('SELECT count(*) FROM merchant_assistant_turns')).rows[0].count,'0');
  }finally{await db.close();}
});
test('assistant migration deduplicates requests and sequence per thread',async()=>{
  const db=await assistantDatabase();try{await thread(db);await turn(db);
    await assert.rejects(turn(db,'duplicate-key','store-a','thread-a',2,'request-a'),(error:any)=>error.code==='23505');
    await assert.rejects(turn(db,'duplicate-sequence','store-a','thread-a',1,'request-b'),(error:any)=>error.code==='23505');
    assert.equal((await db.sql.query('SELECT count(*) FROM merchant_assistant_turns')).rows[0].count,'1');
  }finally{await db.close();}
});
test('assistant migration deduplicates daily account/day/timezone jobs',async()=>{
  const db=await assistantDatabase();try{
    const insert=`INSERT INTO meta_ads_daily_runs(id,merchant_id,account_id,local_day,timezone) VALUES($1,'store-a','100','2026-11-15','America/Sao_Paulo')`;
    await db.sql.query(insert,['run-a']);await assert.rejects(db.sql.query(insert,['run-b']),(error:any)=>error.code==='23505');
    assert.equal((await db.sql.query('SELECT count(*) FROM meta_ads_daily_runs')).rows[0].count,'1');
  }finally{await db.close();}
});
test('assistant migration cascades store deletion without deleting another store history',async()=>{
  const db=await assistantDatabase();try{await thread(db);await thread(db,'thread-b','store-b');await turn(db);await turn(db,'turn-b','store-b','thread-b');
    await db.sql.query(`INSERT INTO meta_ads_daily_runs(id,merchant_id,account_id,local_day,timezone) VALUES('run-a','store-a','100','2026-11-15','America/Sao_Paulo')`);
    await db.sql.query(`DELETE FROM merchants WHERE id='store-a'`);
    assert.deepEqual((await db.sql.query('SELECT merchant_id FROM merchant_assistant_threads')).rows,[{merchant_id:'store-b'}]);
    assert.deepEqual((await db.sql.query('SELECT merchant_id FROM merchant_assistant_turns')).rows,[{merchant_id:'store-b'}]);
    assert.equal((await db.sql.query('SELECT count(*) FROM meta_ads_daily_runs')).rows[0].count,'0');
  }finally{await db.close();}
});
test('assistant migration rejects invalid state, negative reservation and oversized input',async()=>{
  const db=await assistantDatabase();try{await thread(db);await turn(db);
    for(const query of [`UPDATE merchant_assistant_turns SET status='delivered'`,`UPDATE merchant_assistant_turns SET budget_amount_micros=-1`,`UPDATE merchant_assistant_turns SET message=repeat('a',8001)`])
      await assert.rejects(db.sql.query(query),(error:any)=>error.code==='23514');
  }finally{await db.close();}
});
test('additive migration leaves preexisting contracts credits and receipts unchanged',async()=>{
  const db=await testDatabase();try{
    const state={merchantId:'store-a',schemaVersion:1,subscription:{id:'existing',status:'active'},credits:{monthlyAvailable:30}};
    const receipt={contractId:'existing',amountCents:14900};
    await db.sql.query(`INSERT INTO meta_ads_agent_stores(merchant_id,state,updated_at) VALUES('store-a',$1,now())`,[state]);
    await db.sql.query(`INSERT INTO meta_ads_agent_records(id,merchant_id,key,kind,payload) VALUES('receipt','store-a','existing-billing','billing_event',$1)`,[receipt]);
    await db.sql.query(await readFile(new URL('../../../../prisma/migrations/20261116103000_merchant_assistant/migration.sql',import.meta.url),'utf8'));
    assert.deepEqual((await db.sql.query(`SELECT state FROM meta_ads_agent_stores WHERE merchant_id='store-a'`)).rows[0].state,state);
    assert.deepEqual((await db.sql.query(`SELECT payload FROM meta_ads_agent_records WHERE id='receipt'`)).rows[0].payload,receipt);
  }finally{await db.close();}
});
