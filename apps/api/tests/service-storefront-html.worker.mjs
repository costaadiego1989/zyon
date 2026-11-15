import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';

const [directory,apiOrigin,...extra]=process.argv.slice(2);assert.equal(extra.length,0);
const api=new URL(apiOrigin);assert.equal(api.hostname,'127.0.0.1');assert.equal(api.protocol,'http:');assert.equal(api.username,'');assert.equal(api.password,'');assert.ok(Number(api.port)>1024);
process.env.AACP_API_URL=apiOrigin;process.env.NODE_ENV='production';process.env.NEXT_TELEMETRY_DISABLED='1';
const require=createRequire(resolve(directory,'package.json')),loaded=require('next'),next=loaded.default??loaded;
const buildId=readFileSync(resolve(directory,'.next/BUILD_ID'),'utf8').trim();assert.ok(buildId);
let app,server,closed=false;const sockets=new Set();
async function close(){
  if(closed)return;closed=true;
  if(server){const stopped=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));server.closeIdleConnections?.();const closing=[...sockets].map(socket=>new Promise(resolve=>{socket.once('close',resolve);socket.destroy();}));await Promise.all([stopped,...closing]);}
  if(app)await app.close();
  assert.equal(sockets.size,0);return{serverClosed:true,remainingSockets:0};
}
try{
  app=next({dev:false,dir:directory,hostname:'127.0.0.1',port:0});await app.prepare();const handle=app.getRequestHandler();
  server=createServer((request,response)=>{Promise.resolve(handle(request,response)).catch(()=>{response.statusCode=500;response.end('synthetic_next_render_failure');});});
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();assert.equal(address.address,'127.0.0.1');
  process.send({type:'ready',origin:`http://127.0.0.1:${address.port}`,evidence:{actualNextApplication:true,compiledBuildId:buildId}});
  process.on('message',async message=>{
    if(message?.type!=='close')return;
    try{const evidence=await close();process.send({type:'closed',evidence},()=>process.disconnect());}
    catch(error){process.exitCode=1;process.send({type:'failure',code:error.message},()=>process.disconnect());}
  });
  process.on('disconnect',()=>{if(!closed)close().catch(()=>{process.exitCode=1;});});
}catch(error){
  try{await close();}catch{}
  process.exitCode=1;process.send?.({type:'failure',code:error.message},()=>process.disconnect?.());
}
