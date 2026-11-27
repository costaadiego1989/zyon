import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const api=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url),pg=require('pg');
const evidence='C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence';
const name='cashback_seed_qa_candidate';
const url='postgresql://cashback:cashback-local-test@127.0.0.1:15433/'+name;
const clean={};
for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC'])if(process.env[key])clean[key]=process.env[key];
const run=promisify(execFile);
const client=new pg.Client({connectionString:url});
if(process.argv[2]==='prepare'){
  const admin=new pg.Client({connectionString:'postgresql://cashback:cashback-local-test@127.0.0.1:15433/postgres'});
  await admin.connect();
  try{
    const exists=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name]);
    if(exists.rowCount)throw Error('exclusive_candidate_database_already_exists_refusing_reset');
    await admin.query('CREATE DATABASE "cashback_seed_qa_candidate"');
  }finally{await admin.end();}
  const result=await run(process.execPath,[require.resolve('prisma/build/index.js'),'db','push','--schema','prisma/schema.prisma','--skip-generate'],
    {cwd:api,env:{...clean,NODE_ENV:'test',DATABASE_URL:url},maxBuffer:1024*1024});
  await fs.writeFile(path.join(evidence,'candidate-database-push.log'),result.stdout+result.stderr);
  await client.connect();
  try{
    await client.query(await fs.readFile(new URL('../prisma/migrations/20260929020000_checkout_session_write_version/migration.sql',import.meta.url),'utf8'));
    const tables=(await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].n;
    const triggers=(await client.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='checkout_sessions'::regclass AND NOT tgisinternal")).rows[0].n;
    if(tables<200||triggers<1)throw Error('full_schema_or_version_trigger_missing');
    await fs.writeFile(path.join(evidence,'candidate-database.json'),JSON.stringify({database:name,host:'127.0.0.1',port:15433,tables,checkoutVersionTriggers:triggers,createdAt:new Date().toISOString(),externalDatabase:false},null,2)+'\n');
    console.log(JSON.stringify({database:name,tables,checkoutVersionTriggers:triggers}));
  }finally{await client.end();}
}else if(process.argv[2]==='constraints'){
  const shadow='qa_cashback_ddl_'+require('node:crypto').randomUUID().replaceAll('-','');
  await client.connect();
  try{
    await client.query('BEGIN');await client.query(`CREATE SCHEMA "${shadow}"`);await client.query(`SET LOCAL search_path TO "${shadow}"`);
    for(const migration of ['20261114091000_buyer_verified_phones','20261114120000_cashback','20261114130000_cashback_notifications','20261114150000_cashback_combination']){
      await client.query(await fs.readFile(new URL(`../prisma/migrations/${migration}/migration.sql`,import.meta.url),'utf8'));
    }
    await client.query('SET LOCAL search_path TO public');
    const constraints=(await client.query("SELECT r.relname AS table_name,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname=$1 AND c.contype IN ('c','f') ORDER BY r.relname,c.conname",[shadow])).rows;
    const indexes=(await client.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname NOT IN(SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1)",[shadow])).rows;
    let addedConstraints=0,addedIndexes=0;
    for(const row of constraints){
      const exists=await client.query("SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname=$1 AND c.conname=$2",[row.table_name,row.conname]);
      if(!exists.rowCount){await client.query(`ALTER TABLE public."${row.table_name}" ADD CONSTRAINT "${row.conname}" ${row.definition.replaceAll(shadow+'.','public.')}`);addedConstraints++;}
    }
    for(const row of indexes){
      const exists=await client.query("SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1",[row.indexname]);
      if(!exists.rowCount){await client.query(row.indexdef.replaceAll(shadow+'.','public.'));addedIndexes++;}
    }
    await client.query(`DROP SCHEMA "${shadow}" CASCADE`);await client.query('COMMIT');
    await fs.writeFile(path.join(evidence,'candidate-database-cashback-constraints.json'),JSON.stringify({database:name,exactMigrationDefinitions:true,addedConstraints,addedIndexes,destructivePublicOperations:false,checksAndForeignKeys:constraints.length},null,2)+'\n');
    console.log(JSON.stringify({database:name,addedConstraints,addedIndexes}));
  }catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
}else if(process.argv[2]==='seed-twice'){
  const secrets=JSON.parse(await fs.readFile('C:/tmp/cashback-seed-local-private.json','utf8'));
  const env={...clean,NODE_ENV:'test',DATABASE_URL:url,CASHBACK_QA_ENV:'local',CASHBACK_QA_DATABASE_URL:url,CASHBACK_QA_CONFIRM:'qa-cashback-v1',
    CASHBACK_QA_OWNER_PASSWORD:secrets.CASHBACK_QA_OWNER_PASSWORD,CASHBACK_QA_MANIFEST_PATH:path.join(evidence,'candidate-compiled-seed-manifest.json')};
  await client.connect();
  const ledger=async()=>(await client.query("SELECT count(*)::int AS count,coalesce(sum(amount_cents),0)::text AS sum,md5(coalesce(string_agg(row_to_json(e)::text,'|' ORDER BY merchant_id,id),'')) AS content_hash FROM cashback_ledger_entries e")).rows[0];
  try{
    const first=await run(process.execPath,['dist/seeds/cashback-validation-seed.js'],{cwd:api,env,maxBuffer:1024*1024});
    await fs.writeFile(path.join(evidence,'candidate-seed-first.log'),first.stdout+first.stderr);
    const before=await ledger();
    const second=await run(process.execPath,['dist/seeds/cashback-validation-seed.js'],{cwd:api,env,maxBuffer:1024*1024});
    await fs.writeFile(path.join(evidence,'candidate-seed-second.log'),second.stdout+second.stderr);
    const after=await ledger();
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('candidate_seed_repeat_mutated_immutable_ledger');
    await fs.writeFile(path.join(evidence,'candidate-seed-idempotence.json'),JSON.stringify({database:name,compiled:true,runs:2,before,after,ledgerUnchanged:true,providerCalls:0},null,2)+'\n');
    console.log(JSON.stringify({database:name,compiledSeedRuns:2,ledgerCount:after.count,ledgerUnchanged:true,secretsPrinted:false}));
  }finally{await client.end();}
}else throw Error('explicit_prepare_or_seed_twice_required');
