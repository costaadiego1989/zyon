import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dockerEnvironment,assertLocalDockerEndpoint} from './local-disposable-postgres.mjs';

export function assertOwnedServiceNeo4j(info,id,runId){
  assert.match(id,/^[a-f0-9]{64}$/);assert.match(runId,/^[a-f0-9-]{36}$/);
  assert.equal(info.Id,id);assert.equal(info.Name,`/zyon-service-graph-${runId}`);
  assert.equal(info.Config.Labels['com.zyon.service-test'],runId);
  assert.ok(info.Mounts.every(m=>m.Type==='volume'||m.Type==='tmpfs'),'service_graph_host_mount_forbidden');
  const bindings=info.HostConfig.PortBindings;
  assert.deepEqual(Object.keys(bindings),['7687/tcp']);
  assert.equal(bindings['7687/tcp'].length,1);assert.equal(bindings['7687/tcp'][0].HostIp,'127.0.0.1');
}
export async function createServiceTestNeo4j(){
  const execute=promisify(execFile),env=dockerEnvironment(process.env);
  const raw=async args=>(await execute('docker',args,{env,windowsHide:true,timeout:30_000,maxBuffer:1_000_000})).stdout.trim();
  const context=await raw(['context','show']);assert.match(context,/^[A-Za-z0-9_.-]+$/);
  assertLocalDockerEndpoint(await raw(['context','inspect',context,'--format','{{.Endpoints.docker.Host}}']));
  const docker=args=>raw(['--context',context,...args]);
  const image=await docker(['image','inspect','neo4j:5.26-community','--format','{{.Id}}']);assert.match(image,/^sha256:[a-f0-9]{64}$/);
  const runId=randomUUID(),name=`zyon-service-graph-${runId}`,password=randomBytes(24).toString('hex');
  let id,driver,attempted=false;
  const inspect=async target=>JSON.parse(await docker(['inspect',target]))[0];
  const dispose=async()=>{
    await driver?.close();
    if(!id&&attempted){try{const info=await inspect(name);assertOwnedServiceNeo4j(info,info.Id,runId);id=info.Id;}
      catch(error){if(!/No such (?:object|container)/i.test(String(error.stderr??'')))throw error;}}
    if(id){assertOwnedServiceNeo4j(await inspect(id),id,runId);await docker(['rm','--force','--volumes',id]);
      assert.equal(await docker(['ps','--all','--quiet','--no-trunc','--filter',`id=${id}`]),'');id=undefined;}
  };
  try{
    attempted=true;
    id=await docker(['create','--pull=never','--name',name,'--label',`com.zyon.service-test=${runId}`,
      '--publish','127.0.0.1::7687','--memory','1g','--cpus','2',
      '--env',`NEO4J_AUTH=neo4j/${password}`,'--env','NEO4J_server_memory_heap_initial__size=256m',
      '--env','NEO4J_server_memory_heap_max__size=512m','--env','NEO4J_server_memory_pagecache_size=128m',image]);
    assertOwnedServiceNeo4j(await inspect(id),id,runId);await docker(['start',id]);
    const binding=await docker(['port',id,'7687/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);
    const uri=`bolt://${binding}`,neo4j=(await import('neo4j-driver')).default;
    driver=neo4j.driver(uri,neo4j.auth.basic('neo4j',password),{connectionTimeout:1000,maxTransactionRetryTime:0});
    let ready=false;const deadline=Date.now()+90_000;
    while(Date.now()<deadline){try{await driver.verifyConnectivity();ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}
    assert.ok(ready,'service_owned_neo4j_not_ready');
    const query=async(cypher,parameters={})=>{const session=driver.session({database:'neo4j'});try{return(await session.run(cypher,parameters)).records.map(r=>r.toObject());}finally{await session.close();}};
    await query('CREATE (:ServiceTestMarker {runId:$runId})',{runId});
    assert.deepEqual(await query('MATCH (n:ServiceTestMarker) RETURN n.runId AS runId'),[{runId}]);
    return Object.freeze({uri,runId,query,dispose,imageId:image});
  }catch(error){try{await dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'service_graph_setup_cleanup_failed');}throw error;}
}
