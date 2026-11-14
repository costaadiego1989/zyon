import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dockerEnvironment,assertLocalDockerEndpoint} from './local-disposable-postgres.mjs';
import {assertSyntheticRedisIdentity} from './local-disposable-redis.mjs';

export function assertOwnedServiceRedis(info,id,runId){
  assert.match(id,/^[a-f0-9]{64}$/);assert.match(runId,/^[a-f0-9-]{36}$/);
  assert.equal(info.Id,id);assert.equal(info.Name,`/zyon-service-redis-${runId}`);
  assert.equal(info.Config.Labels['com.zyon.service-redis-test'],runId);
  assert.equal(info.HostConfig.ReadonlyRootfs,true);
  assert.ok(info.Mounts.every(m=>m.Type==='tmpfs'),'service_redis_host_or_volume_mount_forbidden');
  assert.deepEqual(Object.keys(info.HostConfig.PortBindings),['6379/tcp']);
  const binding=info.HostConfig.PortBindings['6379/tcp'];assert.equal(binding.length,1);assert.equal(binding[0].HostIp,'127.0.0.1');
}

/** Test-only port publishing avoids docker-exec startup on every connection.
 * The legacy network-none helper and all production timeouts remain unchanged. */
export async function createServiceTestRedis(){
  const execute=promisify(execFile),env=dockerEnvironment(process.env);
  const raw=async args=>(await execute('docker',args,{env,windowsHide:true,timeout:30_000,maxBuffer:1_000_000})).stdout.trim();
  const context=await raw(['context','show']);assert.match(context,/^[A-Za-z0-9_.-]+$/);
  assertLocalDockerEndpoint(await raw(['context','inspect',context,'--format','{{.Endpoints.docker.Host}}']));
  const docker=args=>raw(['--context',context,...args]);
  const image=await docker(['image','inspect','redis:7-alpine','--format','{{.Id}}']);assert.match(image,/^sha256:[a-f0-9]{64}$/);
  const runId=randomUUID(),name=`zyon-service-redis-${runId}`;let id,attempted=false;
  const inspect=async target=>JSON.parse(await docker(['inspect',target]))[0];
  const dispose=async()=>{
    if(!id&&attempted){try{const info=await inspect(name);assertOwnedServiceRedis(info,info.Id,runId);id=info.Id;}
      catch(error){if(!/No such (?:object|container)/i.test(String(error.stderr??'')))throw error;}}
    if(id){assertOwnedServiceRedis(await inspect(id),id,runId);await docker(['rm','--force',id]);
      assert.equal(await docker(['ps','--all','--quiet','--no-trunc','--filter',`id=${id}`]),'');id=undefined;}
  };
  try{
    attempted=true;
    id=await docker(['create','--pull=never','--name',name,'--label',`com.zyon.service-redis-test=${runId}`,
      '--publish','127.0.0.1::6379','--read-only','--user','999:999','--memory','128m','--cpus','1','--pids-limit','64',
      '--cap-drop=ALL','--security-opt','no-new-privileges','--tmpfs','/data:rw,size=32m,uid=999,gid=999,mode=0700',
      image,'redis-server','--bind','0.0.0.0','--protected-mode','no','--port','6379','--save','','--appendonly','no']);
    assertOwnedServiceRedis(await inspect(id),id,runId);await docker(['start',id]);
    let ready=false;const deadline=Date.now()+20_000;
    while(Date.now()<deadline){try{assert.equal(await docker(['exec',id,'redis-cli','PING']),'PONG');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
    assert.ok(ready,'service_owned_redis_not_ready');
    assert.equal(await docker(['exec',id,'redis-cli','SET','aacp:synthetic:run',runId]),'OK');
    assert.equal(await docker(['exec',id,'redis-cli','GET','aacp:synthetic:run']),runId);
    const binding=await docker(['port',id,'6379/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);
    const url=`redis://${binding}/0`;assertSyntheticRedisIdentity(url,runId,runId);
    return Object.freeze({url,runId,dispose,imageId:image,network:'loopback-published'});
  }catch(error){try{await dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'service_redis_setup_cleanup_failed');}throw error;}
}
