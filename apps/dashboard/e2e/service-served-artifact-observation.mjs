import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,mkdirSync,writeFileSync,realpathSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,relative,sep,dirname} from 'node:path';
import {measureServiceReleaseRuntime} from '../../api/dist/shared/bookings/service-release-artifact.js';

const root=fileURLToPath(new URL('../../../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const directories={dashboard:'apps/dashboard/dist',widget:'apps/widget_v2/dist',storefront:'apps/storefront/.next','widget-app':'apps/widget_v2/dist-app'};
export function servedFrontendDigest(id){
  assert.ok(Object.hasOwn(directories,id));const directory=resolve(root,directories[id]),entries=[];
  function walk(current){for(const item of readdirSync(current,{withFileTypes:true})){
    assert.equal(item.isSymbolicLink(),false,'release_frontend_symlink');const path=resolve(current,item.name);
    if(item.isDirectory()){if(item.name!=='cache')walk(path);}else if(item.isFile())entries.push({path:relative(directory,path).split(sep).join('/'),sha256:sha(readFileSync(path))});
  }}
  walk(directory);assert.ok(entries.length>0);entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);return sha(JSON.stringify(entries));
}
export function servedReleaseIdentity(){
  const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  assert.match(sourceRevision,/^[a-f0-9]{40}$/);return measureServiceReleaseRuntime(resolve(root,'apps/api'),sourceRevision);
}
export function assertServedObservationFacts(value){
  assert.ok(value&&Object.hasOwn(directories,value.frontendId));const origin=new URL(value.observedOrigin);
  assert.equal(origin.protocol,'http:');assert.equal(origin.hostname,'127.0.0.1');assert.ok(Number(origin.port)>1024);
  assert.equal(origin.origin,value.observedOrigin);assert.equal(value.responseStatus,200);
  for(const key of ['artifactSha256','releasePayloadSha256','responseSha256'])assert.match(value[key],/^[a-f0-9]{64}$/);
  assert.match(value.sourceRevision,/^[a-f0-9]{40}$/);assert.equal(value.transport,'owned_http');assert.equal(value.kind,'served_artifact_observation');
  assert.notEqual(value.fixtureOnly,true,'release_preview_is_not_a_served_artifact');
}
export async function attachServedArtifact(testInfo,id,response,before,expectedBytes){
  assert.equal(response.status(),200);const bytes=await response.body();assert.ok(bytes.length>0);
  if(expectedBytes)assert.deepEqual(bytes,expectedBytes,'release_served_bytes_changed');
  const current=servedReleaseIdentity();assert.deepEqual(current,before.runtime,'release_runtime_changed_during_browser');
  const artifactSha256=servedFrontendDigest(id);assert.equal(artifactSha256,before.frontends[id],'release_frontend_changed_during_browser');
  const value={kind:'served_artifact_observation',frontendId:id,sourceRevision:current.sourceRevision,artifactSha256,
    releasePayloadSha256:current.apiPayloadSha256,transport:'owned_http',responseStatus:response.status(),
    observedOrigin:new URL(response.url()).origin,responseSha256:sha(bytes),fixtureOnly:false};
  assertServedObservationFacts(value);const path=testInfo.outputPath('served-'+id+'-observation.json');mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await testInfo.attach('served-'+id+'-artifact',{path,contentType:'application/json'});
  return value;
}
export function releaseWidgetBytes(){return readFileSync(resolve(root,'apps/widget_v2/dist/index.js'));}
/** Only the compiled public API URL is remapped. fetch() reaches the existing
 * literal-loopback T3 HTTP proxy and fulfil() forwards that real response,
 * without inventing status, body, authentication or business outcomes. */
export async function installServedReleaseTransport(context,allowedOrigins,apiOrigin='http://127.0.0.1:5187'){
  const file=resolve(root,'.cache/service-release-public-auth.json');
  const configured=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).VITE_API_BASE_URL:'https://127.0.0.1:5187';
  const publicApi=new URL(configured);assert.equal(publicApi.protocol,'https:');assert.ok(!publicApi.username&&!publicApi.password&&!publicApi.search&&!publicApi.hash);
  const ownedApi=new URL(apiOrigin);assert.equal(ownedApi.protocol,'http:');assert.equal(ownedApi.hostname,'127.0.0.1');
  assert.equal(ownedApi.origin,apiOrigin);assert.ok(Number(ownedApi.port)>1024);
  const forwarded=[];
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===publicApi.origin){
      const target=ownedApi.origin+url.pathname+url.search;
      const headers={...request.headers()};for(const name of ['host','content-length','connection'])delete headers[name];
      const response=await context.request.fetch(target,{method:request.method(),headers,data:request.postDataBuffer()??undefined,
        failOnStatusCode:false,maxRedirects:0,timeout:10_000});
      forwarded.push({method:request.method(),path:url.pathname,status:response.status(),targetOrigin:ownedApi.origin});
      await route.fulfill({response});return;
    }
    if(allowedOrigins.has(url.origin)){await route.continue();return;}
    await route.abort('blockedbyclient');
  });
  return forwarded;
}
/** Actual production dashboard bytes; only /v1 calls proxy to the already
 * owned T3 AppModule. The proxy never generates an API response. */
export async function createServedDashboard(){
  return createServedStaticFrontend('dashboard');
}
export async function createServedWidgetApp(){return createServedStaticFrontend('widget-app');}
async function createServedStaticFrontend(id){
  assert.ok(['dashboard','widget-app'].includes(id));
  const directory=resolve(root,directories[id]),sockets=new Set();
  const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
  const server=createServer((req,res)=>{
    if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(req.method)){res.statusCode=405;res.end();return;}
    const url=new URL(req.url,'http://127.0.0.1');
    if(id==='dashboard'&&(url.pathname==='/v1'||url.pathname.startsWith('/v1/'))){
      const forward=httpRequest('http://127.0.0.1:5187'+url.pathname+url.search,{method:req.method,headers:{...req.headers,host:'127.0.0.1:5187'}},up=>{
        res.writeHead(up.statusCode,up.headers);up.pipe(res);
      });forward.on('error',()=>{res.statusCode=502;res.end('owned_dashboard_proxy_failed');});req.pipe(forward);return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.end();return;}
    try{
      const path=resolve(directory,'.'+decodeURIComponent(url.pathname));const rel=relative(directory,path);
      assert.ok(rel!==''&&!rel.startsWith('..')&&!rel.split(sep).includes('node_modules')||path===directory);
      const target=path===directory||!url.pathname.includes('.')?resolve(directory,'index.html'):path;
      const actual=relative(realpathSync(directory),realpathSync(target));assert.ok(actual&&!actual.startsWith('..'),'release_dashboard_asset_escape');
      assert.ok(lstatSync(target).isFile()&&!lstatSync(target).isSymbolicLink());const bytes=readFileSync(target);
      const extension=/\.[a-z0-9]+$/.exec(target)?.[0];res.setHeader('Content-Type',types[extension]??'application/octet-stream');res.setHeader('Cache-Control','no-store');
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch{res.statusCode=404;res.end();}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});const address=server.address();assert.ok(address&&typeof address==='object'&&address.port>1024);
  let closed=false;return {origin:'http://127.0.0.1:'+address.port,indexBytes:readFileSync(resolve(directory,'index.html')),
    async close(){if(closed)return;closed=true;const stopped=new Promise((yes,no)=>server.close(error=>error?no(error):yes()));
      for(const socket of sockets)socket.destroy();await stopped;assert.equal(sockets.size,0,'release_dashboard_sockets_remaining');}};
}
