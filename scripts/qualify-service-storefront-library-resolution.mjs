import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {isAbsolute,resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createStorefrontScopedLibraryPlugin} from '../apps/dashboard/e2e/service-storefront-library-resolution.mjs';

// Explicit qualification only: this module is not imported by a build, fixture
// or runtime. It never starts a listener, AppModule, DB or browser.
const [workspaceArgument,receiptArgument,...extra]=process.argv.slice(2);
assert.equal(extra.length,0);assert.ok(isAbsolute(workspaceArgument??''));assert.ok(isAbsolute(receiptArgument??''));
const workspace=realpathSync(workspaceArgument),dashboard=resolve(workspace,'apps/dashboard'),storefront=resolve(workspace,'apps/storefront/src');
const requireFromDashboard=createRequire(resolve(dashboard,'package.json'));
const vitePackagePath=requireFromDashboard.resolve('vite/package.json'),vitePackage=JSON.parse(readFileSync(vitePackagePath,'utf8'));
const {createServer}=await import(pathToFileURL(resolve(dirname(vitePackagePath),'dist/node/index.js')).href);
const importer=resolve(storefront,'components/StorefrontConsent.tsx'),component=readFileSync(importer,'utf8');
const ids=['@/lib/buyer-auth','@/lib/storefront-consent'];
for(const id of ids)assert.ok(component.includes(id),'current_storefront_component_import_missing');
const dashboardImporter=resolve(dashboard,'src/main.tsx');
const pluginPath=fileURLToPath(new URL('../apps/dashboard/e2e/service-storefront-library-resolution.mjs',import.meta.url));
const options=plugins=>({root:dashboard,configFile:resolve(dashboard,'vite.config.ts'),envFile:false,
  logLevel:'error',clearScreen:false,appType:'custom',plugins,
  optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null}});
let baseline,candidate,failure;const cleanup=[],observations=[];
const initialHandles=new Set(process._getActiveHandles()),listenerObservations=[];
function assertNoOwnedListener(stage){
  const listeners=process._getActiveHandles().filter(handle=>!initialHandles.has(handle)&&handle?.constructor?.name==='Server'&&handle.listening===true);
  listenerObservations.push({stage,listeningServers:listeners.length});
  assert.equal(listeners.length,0,'vite_resolution_qualification_listener_forbidden');
}
const normalize=result=>result===null?null:{id:result.id,external:result.external??false};
try{
  baseline=await createServer(options([]));assert.equal(baseline.httpServer,null);assertNoOwnedListener('baseline_created');
  const expectedDashboard=normalize(await baseline.pluginContainer.resolveId(ids[0],dashboardImporter));
  await baseline.close();baseline=undefined;
  candidate=await createServer(options([createStorefrontScopedLibraryPlugin(storefront)]));assert.equal(candidate.httpServer,null);assertNoOwnedListener('candidate_created');
  for(const id of ids){
    const result=await candidate.pluginContainer.resolveId(id,importer);
    assert.ok(result&&!result.external,'actual_vite_storefront_import_unresolved');
    const expected=realpathSync(resolve(storefront,'lib',id.slice('@/lib/'.length)+'.ts'));
    assert.equal(realpathSync(result.id),expected);
    observations.push({import:id,importerKind:'storefront',resolvedId:result.id,expectedId:expected});
  }
  const actualDashboard=normalize(await candidate.pluginContainer.resolveId(ids[0],dashboardImporter));
  assert.deepEqual(actualDashboard,expectedDashboard,'existing_dashboard_resolution_changed');
  observations.push({import:ids[0],importerKind:'dashboard',baseline:expectedDashboard,actual:actualDashboard});
  const traversal=await candidate.pluginContainer.resolveId('@/lib/../../private',importer);
  assert.equal(traversal,null,'actual_vite_storefront_library_escape');
}catch(error){failure=error;}
finally{
  for(const server of[candidate,baseline])if(server)try{await server.close();}catch(error){cleanup.push(error);}
  try{assertNoOwnedListener('all_closed');}catch(error){cleanup.push(error);}
}
if(failure&&cleanup.length)throw new AggregateError([failure,...cleanup],'vite_qualification_and_cleanup_failed');
if(failure)throw failure;
if(cleanup.length)throw new AggregateError(cleanup,'vite_qualification_cleanup_failed');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt={kind:'ACTUAL_VITE_PLUGIN_CONTAINER_QUALIFICATION',workspace,viteVersion:vitePackage.version,
  vitePackagePath,pluginSha256:sha(readFileSync(pluginPath)),componentSha256:sha(readFileSync(importer)),
  observations,listenerObservations,allViteServersClosed:true,appModuleStarted:false,dbStarted:false,browserStarted:false};
writeFileSync(receiptArgument,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(receipt));
