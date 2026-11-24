import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {buyerStorefrontInit,BUYER_STOREFRONT_ORIGIN} from './service-buyer-storefront-contract.mjs';

// No caller path, command, mode or product flag. Only this worktree's built Next.
assert.equal(process.argv.length,2);const directory=fileURLToPath(new URL('../../storefront/',import.meta.url));
let app,server,initialized=false,closed=false;const sockets=new Set();
const deadline=setTimeout(()=>{process.exitCode=1;process.disconnect?.();},45_000);
async function close(){
  if(closed)return;closed=true;clearTimeout(deadline);
  if(server){const socketClosures=[...sockets].map(socket=>new Promise(resolve=>socket.once('close',resolve)));const stopped=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    server.closeIdleConnections?.();for(const socket of sockets)socket.destroy();await stopped;await Promise.all(socketClosures);}
  if(app)await app.close();
  assert.equal(sockets.size,0);return{serverClosed:true,remainingSockets:0};
}
process.on('message',async raw=>{
  if(raw?.type==='close'){
    try{const evidence=await close();process.send({type:'buyer_storefront_closed',evidence},()=>process.disconnect());}
    catch{process.exitCode=1;process.send({type:'buyer_storefront_failure',code:'buyer_storefront_cleanup_failed'},()=>process.disconnect());}
    return;
  }
  try{
    assert.equal(initialized,false,'buyer_storefront_init_once');initialized=true;
    const message=buyerStorefrontInit(raw,raw?.runId),manifest=readFileSync(resolve(directory,'.next/required-server-files.json'));
    assert.equal(readFileSync(resolve(directory,'.next/BUILD_ID'),'utf8').trim(),message.artifact.buildId);
    assert.equal(createHash('sha256').update(manifest).digest('hex'),message.artifact.manifestSha256);
    assert.equal(JSON.parse(manifest).config.env.NEXT_PUBLIC_API_BASE_URL,'/api/v1');
    Object.assign(process.env,{AACP_API_URL:message.apiOrigin,INTERNAL_SERVICE_TOKEN:message.credential,
      NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'});
    // Secrets never enter ready/errors/output. Productive route handlers receive
    // the same server credential used by the canonical local AppModule.
    const require=createRequire(resolve(directory,'package.json')),loaded=require('next'),next=loaded.default??loaded;
    app=next({dev:false,dir:directory,hostname:'127.0.0.1',port:5188});await app.prepare();const handle=app.getRequestHandler();
    server=createServer((request,response)=>{Promise.resolve(handle(request,response)).catch(()=>{response.statusCode=500;response.end('owned_next_request_failed');});});
    server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5188,'127.0.0.1',resolve);});
    clearTimeout(deadline);process.send({type:'buyer_storefront_ready',runId:message.runId,origin:BUYER_STOREFRONT_ORIGIN,
      artifact:message.artifact,actualNextApplication:true});
  }catch{
    try{await close();}catch{}process.exitCode=1;
    process.send?.({type:'buyer_storefront_failure',code:'buyer_storefront_start_failed'},()=>process.disconnect?.());
  }
});
process.on('disconnect',()=>{if(!closed)close().catch(()=>{process.exitCode=1;});});
