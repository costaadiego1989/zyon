// Detached, audited maintenance runner for the user's 25 GB regional recovery.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {Client}=require('pg');
const folder='/tmp/zyon-retail-recovery-20261123';
const descriptor=JSON.parse(fs.readFileSync(path.join(folder,'job.json'),'utf8'));
const state={phase:'starting',pid:process.pid,jobId:descriptor.jobId,sourceJobId:descriptor.sourceJobId,startedAt:new Date().toISOString(),selectedCompanies:0,committedRecords:0,validatedFiles:0,requiredFiles:23};
const save=()=>{fs.writeFileSync(folder+'/status.pending',JSON.stringify({...state,updatedAt:new Date().toISOString()},null,2));fs.renameSync(folder+'/status.pending',folder+'/status.json');};
async function main(){
 assert.equal(process.cwd(),'/repo/apps/api');
 for(const key of ['META_SEND_ENABLED','LLM_REAL_ENABLED','PAID_INGESTION_ENABLED','RUN_WORKERS'])assert.equal(process.env['PROSPECTING_'+key],'false');
 assert.equal(process.env.PROSPECTING_ENABLED,'true');assert.equal(process.env.PROSPECTING_INGESTION_ENABLED,'true');
 const at=relative=>import(pathToFileURL(path.join(process.cwd(),relative)).href);
 const recovery=await at('scripts/prospecting-retail-recovery.mjs');
 const {guardProspectingImportBatch}=await at('scripts/prospecting-storage-guard.mjs');
 const {createDirectoryPrismaClient}=await at('dist/modules/platform-prospecting/infrastructure/company-directory/directory-prisma-client.js');
 const {PrismaDirectoryRepository}=await at('dist/modules/platform-prospecting/infrastructure/company-directory/prisma-directory.repository.js');
 const {CnpjArchiveReader}=await at('dist/modules/platform-prospecting/infrastructure/company-directory/cnpj-archive-reader.js');
 const pg=new Client({connectionString:process.env.DATABASE_URL}),heartbeat=new Client({connectionString:process.env.DATABASE_URL});
 await pg.connect();await heartbeat.connect();
 assert.equal((await pg.query('SELECT current_database() AS name')).rows[0].name,'aacp_prod');
 assert.equal((await pg.query("SELECT pg_try_advisory_lock(hashtext('official-cnpj-production-worker'),hashtext(current_database())) AS locked")).rows[0].locked,true,'official_import_worker_busy');
 const command=(await pg.query('SELECT actor_operator_id,kind,state,result FROM prospect_commands WHERE client_request_id=$1',[descriptor.commandId])).rows[0];
 assert.ok(command);assert.equal(command.actor_operator_id,descriptor.operatorId);assert.equal(command.kind,'company_import_start');assert.equal(command.state,'completed');assert.equal(command.result.importJobId,descriptor.jobId);
 const client=createDirectoryPrismaClient({databaseUrl:process.env.PROSPECTING_DATABASE_URL,directoryDatabaseUrl:process.env.PROSPECTING_DIRECTORY_DATABASE_URL,directoryPoolSize:2});
 const repo=new PrismaDirectoryRepository(client,process.env.PROSPECTING_CURSOR_HMAC_KEY);
 const sourceManifest=await repo.getManifest(descriptor.sourceJobId),sourceStatus=await repo.getImport(descriptor.sourceJobId),manifest=await repo.getManifest(descriptor.jobId);
 assert.ok(sourceManifest&&sourceStatus&&manifest);assert.deepEqual(manifest,recovery.retailRecoveryManifest(sourceManifest));
 if((await repo.getImport(descriptor.jobId)).state==='published'){state.phase='completed';save();await client.$disconnect();await heartbeat.end();await pg.end();return;}
 const owner=require('node:crypto').randomUUID();await repo.claimImport(descriptor.jobId,owner,new Date());
 const staging=new recovery.RetailRecoveryStaging(folder+'/staging.sqlite');staging.bind(manifest);
 const controller=new AbortController();let saving=false,stopped=false;
 const stop=()=>{stopped=true;controller.abort();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const publicError=error=>{const message=String(error.message);return /^[a-z][a-z0-9_]*(?::[a-z0-9_]+)?$/.test(message)?message:'regional_import_failed';};
 const flush=async()=>{
  if(saving)return;saving=true;
  try{
   state.selectedCompanies=staging.count('establishments');state.validatedFiles=staging.count('files');
   const progress={phase:state.phase,selectedCompanies:state.selectedCompanies,committedRecords:state.committedRecords,validatedFiles:state.validatedFiles,requiredFiles:23,updatedAt:new Date().toISOString()};
   await heartbeat.query("UPDATE company_directory.company_snapshots SET counts=counts||$2::jsonb,updated_at=now() WHERE id=$1 AND state<>'published'",[manifest.id,JSON.stringify({leaseToken:owner,leaseUntil:Date.now()+600000,requested:false,progress})]);save();
  }finally{saving=false;}
 };
 const progress=async update=>{if(stopped)throw Error('operator_stopped');Object.assign(state,update);save();};
 const timer=setInterval(()=>{if(fs.existsSync(folder+'/stop'))stop();void flush().catch(error=>{state.heartbeatError=publicError(error);save();});},10000);
 const reader=new CnpjArchiveReader({async openResource(input){
  const url=new URL(input);assert.equal(url.origin,'https://arquivos.receitafederal.gov.br');assert.ok(url.pathname.startsWith('/public.php/dav/files/YggdBLfdninEJX9/'));
  const phase=state.phase;await progress({phase:'downloading',resource:url.pathname.split('/').at(-1),downloadBytes:0});
  const response=await fetch(url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(7200000)])});
  if(!response.ok||!response.body)return response;
  const body=response.body.pipeThrough(new TransformStream({transform(chunk,output){state.downloadBytes+=chunk.length;output.enqueue(chunk);},flush(){state.phase=phase;save();}}));
  return new Response(body,{status:response.status,headers:response.headers});
 }},{importMaximumFileBytes:4*1024**3,importMaximumExpandedBytes:100*1024**3,importMaximumEntries:100,importMaximumLineBytes:1024**2,importMaximumMemoryBytes:256*1024**2,importMinimumFreeDiskBytes:10*1024**3});
 const filtered={async prepare(resource){const roots=resource.family==='empresas'?staging.missingRoots():undefined;return reader.prepare(resource,(record,family)=>recovery.retailRecordFilter(record,family,roots));}};
 try{
  await flush();
  for(let retry=0;;retry++){
   try{await recovery.prepareRetailFiles({staging,manifest,reader:filtered,progress});await recovery.prepareRetailEntities({pg,staging,manifest,sourceFiles:sourceStatus.files,reader:filtered,progress});break;}
   catch(error){if(stopped||retry>=3||!/source_unavailable|fetch failed|ECONNRESET|ETIMEDOUT/.test(error.message))throw error;state.retry=retry+1;save();await new Promise(resolve=>setTimeout(resolve,10000));}
  }
  await progress({phase:'prepared'});await flush();
  const actor={operatorId:descriptor.operatorId,correlationId:descriptor.correlationId};
  await progress({phase:'reclaiming_staging'});await flush();
  await recovery.reclaimFailedDirectory(pg,{sourceSnapshotId:sourceManifest.id,snapshotId:manifest.id,actor,staging,manifest});
  let checkpointAt=0;
  await recovery.persistRetailDirectory({pg,staging,manifest,guard:guardProspectingImportBatch,progress:async update=>{
   await progress(update);
   if(Date.now()-checkpointAt>10000){checkpointAt=Date.now();state.committedRecords=Number((await pg.query(`SELECT (SELECT count(*) FROM company_directory.company_entities WHERE snapshot_id=$1)+(SELECT count(*) FROM company_directory.company_establishments WHERE snapshot_id=$1)+(SELECT count(*) FROM company_directory.source_domains WHERE snapshot_id=$1) AS n`,[manifest.id])).rows[0].n);await flush();}
  }});
  await progress({phase:'publishing'});await flush();
  state.coverage=await recovery.publishRetailDirectory(pg,staging,manifest,actor);state.phase='completed';state.completedAt=new Date().toISOString();save();
  console.log(JSON.stringify({event:'regional_retail_published',jobId:manifest.id,coverage:state.coverage}));
 }catch(error){
  clearInterval(timer);while(saving)await new Promise(resolve=>setTimeout(resolve,20));
  state.phase='failed';state.error=publicError(error);state.finishedAt=new Date().toISOString();await flush();
  await repo.failImport(manifest.id,owner,null,state.error);save();throw error;
 }finally{
  clearInterval(timer);while(saving)await new Promise(resolve=>setTimeout(resolve,20));staging.close();await client.$disconnect();await heartbeat.end();await pg.end();
 }
}
main().catch(error=>{state.phase='failed';state.error=String(error.message).replace(/[^a-z0-9_:.-]/gi,' ').slice(0,180);save();console.error(JSON.stringify({event:'regional_retail_failed',code:state.error}));process.exit(1);});
