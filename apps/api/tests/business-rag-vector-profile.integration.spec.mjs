import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setTimeout as pause} from 'node:timers/promises';
import {createProfessionalHttpFixture} from './service-professional-http-fixture.mjs';
import {companyHttpFixture} from './service-company-http-fixture.mjs';
import {assertNativePrismaUrl} from './native-prisma-admission-guards.mjs';
import {migrationName,migrationPath,assertServiceSchema} from './service-migration-bootstrap.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {exerciseLegacyKnowledgeNamespaceJsonCases,exerciseLegacyKnowledgeNamespacePgvectorCases} from './business-rag-legacy-namespace.cases.mjs';

const imageId='sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a';
const repoDigest='pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a';
const q=[1,...Array(383).fill(0)],other=[0,1,...Array(382).fill(0)];
const quoted=value=>"'"+String(value).replaceAll("'","''")+"'";
async function until(check,code){
  const deadline=Date.now()+5000;
  do{if(await check())return;if(Date.now()<deadline)await pause(20);}while(Date.now()<deadline);
  assert.fail(code);
}
async function bounded(work,code){
  let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),5000);})]);}
  finally{clearTimeout(timer);}
}
let precedingFixtureClosed=true;

// Await each top-level root, including its actual cleanup, before starting the
// other profile. No filter, skip, parallel fixture or alternative backend.
for(const profile of [undefined,'pgvector16'])await test('T66 vector profile '+(profile??'default'),
  {timeout:SERVICE_LOCAL_TEST_MS,concurrency:false},async t=>{
    assert.equal(precedingFixtureClosed,true,'the preceding owned fixture must have completely closed');
    const f=profile===undefined?await createProfessionalHttpFixture():await createProfessionalHttpFixture({postgresProfile:profile});
    precedingFixtureClosed=false;
    const db=f.runtime.db,url=assertNativePrismaUrl(db.prismaUrl),clients=new Set();
    let closeAttempted=false,initialOwnership;
    const probe=async port=>{
      assert.equal(typeof db.bridgeConnectionStatus,'function','test-only owned per-connection probe required; no global-count fallback');
      assert.ok(Number.isInteger(port)&&port>0&&port<=65535);
      return await db.bridgeConnectionStatus(port);
    };
    const inspect=async()=>{
      assert.equal(typeof db.inspectOwned,'function','test-only pinned-context UUID-owned inspection probe required');
      return await db.inspectOwned();
    };
    const open=async label=>{
      const applicationName='t66-'+label+'-'+randomUUID();
      const client=new Client({host:url.hostname,port:Number(url.port),user:'postgres',database:'storefront_synthetic',ssl:false,
        connectionTimeoutMillis:Number(url.searchParams.get('connect_timeout'))*1000,application_name:applicationName});
      clients.add(client);const errors=[];client.on('error',error=>{errors.push({code:String(error.code??'connection_closed')});});
      await client.connect();
      const stream=client.connection.stream,port=stream.localPort;
      assert.equal(stream.localAddress,'127.0.0.1');
      const row=(await client.query('SELECT pg_backend_pid() AS pid,current_setting($1) AS application',['application_name'])).rows[0];
      assert.equal(row.application,applicationName);assert.ok(Number.isInteger(row.pid)&&row.pid>0);
      await until(async()=>{const state=await probe(port);return state.sockets===1&&state.children===1;},'owned_profile_connection_not_tracked');
      return{client,stream,port,pid:row.pid,applicationName,errors};
    };
    const end=async connection=>{
      await bounded(connection.client.end(),'owned_profile_client_end_timeout');
      await until(()=>connection.stream.destroyed,'owned_profile_client_socket_remaining');clients.delete(connection.client);
    };
    const closeFixture=async()=>{
      if(closeAttempted)return;closeAttempted=true;
      await f.close();
      assert.deepEqual(f.runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
      assert.deepEqual(db.bridgeStatus(),{listening:false,sockets:0,children:0});
      const gone=await inspect();assert.equal(gone.exists,false);assert.equal(gone.id,initialOwnership.id);assert.equal(gone.runId,db.runId);
      assert.equal(f.runtime.evidence().providerCalls,0);precedingFixtureClosed=true;
    };
    try{
      await t.test('actual AppModule HTTP Prisma marker migration ledger and container ownership agree',async()=>{
        const evidence=f.runtime.evidence();assert.equal(evidence.canonicalAppModule,true);
        assert.equal(evidence.repositoryOverrides,false);assert.equal(evidence.authOverrides,false);assert.equal(evidence.providerCalls,0);
        assert.deepEqual(evidence.localProviderOverrides,[]);assert.equal(evidence.embeddingRuntime.allowRemoteModels,false);
        assert.equal(await db.sql('SELECT run_id FROM synthetic_native_marker'),db.runId);
        const receipt=await db.sql(`SELECT checksum FROM _prisma_migrations WHERE migration_name=${quoted(migrationName)} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`);
        assert.equal(receipt,createHash('sha256').update(readFileSync(migrationPath)).digest('hex'));
        initialOwnership=await inspect();assert.equal(initialOwnership.exists,true);assert.match(initialOwnership.id,/^[a-f0-9]{64}$/);
        assert.equal(initialOwnership.name,'/aacp-write-db-'+db.runId);assert.equal(initialOwnership.runId,db.runId);
        assert.equal(initialOwnership.imageId,db.imageId);assert.equal(initialOwnership.networkMode,'none');assert.equal(initialOwnership.readOnlyRootfs,true);
        assert.equal(Object.keys(initialOwnership.portBindings).length,0);assert.ok(initialOwnership.mounts.length>0);
        assert.ok(initialOwnership.mounts.every(mount=>mount.type==='tmpfs'));
        const uid=profile?999:70;assert.equal(initialOwnership.user,uid+':'+uid);
        assert.equal(initialOwnership.tmpfs['/var/lib/postgresql/data'],'rw,size=256m,uid='+uid+',gid='+uid+',mode=0700');
        assert.equal(initialOwnership.tmpfs['/var/run/postgresql'],'rw,size=16m,uid='+uid+',gid='+uid);
        if(profile){assert.equal(db.profile,'pgvector16');assert.equal(db.imageId,imageId);assert.equal(db.repoDigest,repoDigest);}
        else{assert.equal(db.profile,undefined);await assertServiceSchema(db);assert.equal(evidence.postgresVector,undefined);}
        const http=companyHttpFixture(f.runtime),correlationId=randomUUID(),description='Actual local '+(profile??'default')+' company';
        const saved=await http.request('/merchants/me/store-settings',{company:{description}},f.owner.access_token,'PUT',
          {'idempotency-key':randomUUID(),'x-correlation-id':correlationId});
        assert.equal(saved.status,200);assert.equal(saved.headers.get('x-correlation-id'),correlationId);
        await until(async()=>{
          const audit=await f.prisma.merchantAuditEvent.findFirst({where:{merchantId:f.owner.merchant_id,correlationId}});
          if(!audit)return false;assert.equal(audit.actorId,f.owner.user_id);assert.equal(audit.action,'http.put');
          assert.equal(audit.outcome,'success');assert.equal(audit.metadata.statusCode,200);return true;
        },'owned_profile_http_audit_unsettled');
        assert.equal((await f.prisma.merchant.findUnique({where:{id:f.owner.merchant_id}})).storeSettings.company.description,description);
        const response=await http.request('/merchants/me/store-settings',undefined,f.owner.access_token,'GET');
        assert.equal(response.status,200);assert.equal(response.body.company.description,description);
      });

      await t.test('large native PostgreSQL parameter and result traverse the actual owned duplex bridge',async()=>{
        const connection=await open('large');
        try{
          const payload='á🌿🧪'.repeat(65536),bytes=Buffer.byteLength(payload,'utf8');assert.ok(bytes>512*1024);
          const row=(await connection.client.query('SELECT $1::text AS payload,octet_length($1::text) AS bytes',[payload])).rows[0];
          assert.equal(row.payload,payload);assert.equal(row.bytes,bytes);
          const prisma=await f.prisma.$queryRaw`SELECT ${payload}::text AS payload`;
          assert.equal(prisma[0].payload,payload);
        }finally{await end(connection);}
      });

      await t.test(profile?'real vector384 catalog operators storage and cosine ranking work':'default schema uses actual JSON fallback without a vector column',async()=>{
        const sourceId='synthetic-profile-'+randomUUID(),merchantId=f.owner.merchant_id;
        await f.prisma.knowledgeChunk.create({data:{merchantId,sourceType:'faq',sourceId,content:'Named synthetic vector transport candidate',embedding:JSON.stringify(q)}});
        if(!profile){
          assert.equal(await db.sql("SELECT count(*) FROM pg_attribute WHERE attrelid='knowledge_chunks'::regclass AND attname='embedding_vec' AND NOT attisdropped"),'0');
          assert.equal(await db.sql("SELECT count(*) FROM pg_extension WHERE extname='vector'"),'0');
          const {PrismaKnowledgeRepository}=await import('../dist/modules/knowledge-base/infrastructure/repositories/prisma-knowledge.repository.js');
          const chunks=await new PrismaKnowledgeRepository(f.prisma).similaritySearch(merchantId,q,1,0.99);
          assert.equal(chunks.length,1);assert.equal(chunks[0].sourceId,sourceId);assert.equal(chunks[0].similarity,1);
        }else{
          const prep=f.runtime.evidence().postgresVector;assert.ok(prep);assert.equal(prep.columnType,'vector(384)');assert.equal(prep.extension,'0.8.7');
          const connection=await open('vector');
          try{
            const catalog=(await connection.client.query(`SELECT (SELECT extversion FROM pg_extension WHERE extname='vector') AS version,
              (SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='knowledge_chunks'::regclass AND attname='embedding_vec' AND NOT attisdropped) AS type,
              vector_dims($1::vector(384)) AS dimensions,1-($1::vector(384)<=>$1::vector(384)) AS same,1-($1::vector(384)<=>$2::vector(384)) AS other`,[JSON.stringify(q),JSON.stringify(other)])).rows[0];
            assert.deepEqual(catalog,{version:'0.8.7',type:'vector(384)',dimensions:384,same:1,other:0});
            const index=(await connection.client.query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='knowledge_chunks_embedding_vec_idx'")).rows[0];
            assert.match(index.indexdef,/USING hnsw \(embedding_vec vector_cosine_ops\)/);
            // Orthogonal JSON means these positives cannot be supplied by JSON fallback.
            await connection.client.query('UPDATE knowledge_chunks SET embedding=$1,embedding_vec=$2::vector(384) WHERE merchant_id=$3 AND source_id=$4',
              [JSON.stringify(other),JSON.stringify(q),merchantId,sourceId]);
            const result=(await connection.client.query('SELECT source_id,vector_dims(embedding_vec) AS dimensions,1-(embedding_vec<=>$1::vector(384)) AS similarity FROM knowledge_chunks WHERE merchant_id=$2 AND source_id=$3 ORDER BY embedding_vec<=>$1::vector(384) LIMIT 1',
              [JSON.stringify(q),merchantId,sourceId])).rows[0];
            assert.deepEqual(result,{source_id:sourceId,dimensions:384,similarity:1});
            const {PrismaKnowledgeRepository}=await import('../dist/modules/knowledge-base/infrastructure/repositories/prisma-knowledge.repository.js');
            const chunks=await new PrismaKnowledgeRepository(f.prisma).similaritySearch(merchantId,q,1,0.99);
            assert.equal(chunks.length,1);assert.equal(chunks[0].sourceId,sourceId);assert.equal(chunks[0].similarity,1);
          }finally{await end(connection);}
        }
      });

      await t.test('client EOF and exact owned backend EOF drain their individual bridge socket and child',async()=>{
        const clientEof=await open('client-eof');await end(clientEof);
        await until(async()=>Number(await db.sql(`SELECT count(*) FROM pg_stat_activity WHERE pid=${clientEof.pid}`))===0,'client_eof_backend_remaining');
        await until(async()=>{const state=await probe(clientEof.port);return state.sockets===0&&state.children===0;},'client_eof_bridge_resources_remaining');
        const serverEof=await open('server-eof');
        try{
          assert.equal(await db.sql(`SELECT application_name FROM pg_stat_activity WHERE pid=${serverEof.pid}`),serverEof.applicationName);
          const closed=new Promise(resolve=>serverEof.stream.once('close',resolve));
          assert.equal(await db.sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=${serverEof.pid} AND application_name=${quoted(serverEof.applicationName)}`),'t');
          await bounded(closed,'server_eof_client_socket_remaining');assert.equal(serverEof.stream.destroyed,true);
          await until(async()=>{const state=await probe(serverEof.port);return state.sockets===0&&state.children===0;},'server_eof_bridge_resources_remaining');
          assert.equal(await db.sql(`SELECT count(*) FROM pg_stat_activity WHERE pid=${serverEof.pid}`),'0');
        }finally{await end(serverEof);}
      });

      if(profile)await exerciseLegacyKnowledgeNamespacePgvectorCases(t,f);
      else await exerciseLegacyKnowledgeNamespaceJsonCases(t,f);

      await t.test('owned runtime disposal interrupts a verified active query and proves container listener sockets and children gone',async()=>{
        const active=await open('active-disposal');
        const result=active.client.query('SELECT pg_sleep(60)').then(()=>({status:'resolved'}),error=>({status:'rejected',code:String(error.code??'connection_closed')}));
        // Handler is attached before any await. This operation stays background;
        // there is no fixed60s wait or increased query/cleanup deadline.
        await until(async()=>Number(await db.sql(`SELECT count(*) FROM pg_stat_activity WHERE pid=${active.pid} AND application_name=${quoted(active.applicationName)} AND state='active' AND query='SELECT pg_sleep(60)'`))===1,'owned_disposal_query_not_observed_active');
        await closeFixture();
        assert.equal((await bounded(result,'owned_disposal_query_did_not_settle')).status,'rejected');
        await until(()=>active.stream.destroyed,'owned_disposal_client_socket_remaining');
        assert.deepEqual(await probe(active.port),{sockets:0,children:0});
        await end(active);
      });
    }finally{
      const errors=[];
      for(const client of clients){try{await bounded(client.end(),'owned_profile_final_client_cleanup_timeout');}catch(error){errors.push(error);}}
      if(!closeAttempted){try{await closeFixture();}catch(error){errors.push(error);}}
      if(errors.length)throw new AggregateError(errors,'owned_vector_profile_cleanup_failed');
    }
  });
