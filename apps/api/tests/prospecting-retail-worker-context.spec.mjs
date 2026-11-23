import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require=createRequire(import.meta.url),{retailWorkerContext}=require('../scripts/prospecting-retail-worker-context.cjs');
const cwd=path.resolve('apps/api'),url='postgresql://worker:private-example@127.0.0.1:15439/aacp_prod';
const env={DATABASE_URL:url,PROSPECTING_DATABASE_URL:url,PROSPECTING_DIRECTORY_DATABASE_URL:url};

test('REC-04 native execution retains the original fixed container and staging guards',()=>{
 const context=retailWorkerContext({cwd:'/repo/apps/api'});
 assert.equal(context.apiRoot,'/repo/apps/api');assert.equal(context.folder,'/tmp/zyon-retail-recovery-20261123');assert.equal(context.mode,'railway');
 assert.throws(()=>retailWorkerContext({cwd}),/recovery_worker_directory_invalid/);
});
test('REC-04 standalone staging stays in the owned persistent workspace outside API temporary storage',()=>{
 const context=retailWorkerContext({standalone:true,cwd,env});
 assert.equal(context.mode,'standalone');assert.equal(context.apiRoot,cwd);
 assert.equal(context.folder,path.resolve('.specs/features/admin-prospecting-import-recovery/standalone-runtime'));
 assert.equal(path.relative(cwd,context.folder).startsWith('..'+path.sep),true);
 assert.equal(context.folder.includes('/tmp/zyon-retail-recovery-20261123'),false);
 assert.throws(()=>retailWorkerContext({standalone:true,cwd:path.dirname(cwd),env}),/recovery_worker_directory_invalid/);
});
test('REC-04 standalone execution accepts only the private loopback tunnel and intended production database',()=>{
 for(const bad of ['postgresql://worker:private-example@public.example:15439/aacp_prod',
  'postgresql://worker:private-example@0.0.0.0:15439/aacp_prod',
  'postgresql://worker:private-example@127.0.0.1:5432/aacp_prod',
  'postgresql://worker:private-example@127.0.0.1:15439/other_database',
  'http://127.0.0.1:15439/aacp_prod','invalid-private-example']){
  assert.throws(()=>retailWorkerContext({standalone:true,cwd,env:{DATABASE_URL:bad,PROSPECTING_DATABASE_URL:bad,PROSPECTING_DIRECTORY_DATABASE_URL:bad}}),error=>{
   assert.equal(error.message,'standalone_database_config_invalid');assert.equal(error.message.includes('private-example'),false);return true;
  });
 }
});
test('REC-04 standalone directory and operational clients cannot target different databases',()=>{
 for(const key of ['PROSPECTING_DATABASE_URL','PROSPECTING_DIRECTORY_DATABASE_URL'])
  assert.throws(()=>retailWorkerContext({standalone:true,cwd,env:{...env,[key]:url.replace('15439','15438')}}),/standalone_database_config_invalid/);
});
test('REC-04 driver query overrides and fragments cannot escape the private SSH destination',()=>{
 const {Client}=require('pg');
 const overridden=url+'?host=public.example&port=5432',effective=new Client({connectionString:overridden}).connectionParameters;
 assert.equal(effective.host,'public.example');assert.equal(effective.port,5432);
 for(const suffix of ['?host=public.example&port=5432','?host=/var/run/postgresql','?database=other_database','?sslmode=disable','#external']){
  const bad=url+suffix;
  assert.throws(()=>retailWorkerContext({standalone:true,cwd,env:{DATABASE_URL:bad,PROSPECTING_DATABASE_URL:bad,PROSPECTING_DIRECTORY_DATABASE_URL:bad}}),/standalone_database_config_invalid/);
 }
 const accepted=new Client({connectionString:url}).connectionParameters;
 assert.equal(accepted.host,'127.0.0.1');assert.equal(accepted.port,15439);assert.equal(accepted.database,'aacp_prod');
});
