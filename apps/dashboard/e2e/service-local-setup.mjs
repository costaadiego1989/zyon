import {createServer} from 'vite';
import {installCompanyFixture} from './service-company-fixture.mjs';
import {installCompanyServicesFixture} from './service-company-services-fixture.mjs';
import {installCatalogBusinessModeFixture} from './service-catalog-fixture.mjs';
import {installCatalogEntitlementFixture,prepareCatalogEntitlementFixtures} from './service-catalog-entitlement-fixture.mjs';
import {installAttendanceFixture,prepareAttendanceFixtures} from './service-attendance-fixture.mjs';
import {installProfessionalFixture,prepareProfessionalFixtures} from './service-professionals-fixture.mjs';
import {installCategoryFixture,prepareCategoryFixtures} from './service-categories-fixture.mjs';
import {installCatalogProfessionalFixture,prepareCatalogProfessionalFixtures} from './service-catalog-professionals-fixture.mjs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServiceTestRuntime} from '../../api/tests/service-test-runtime.mjs';
import {assertLocalServiceOrigin,serviceBrowserEnvironment} from './service-local-scope.mjs';
import {observeProviderTrapFailure,operatorDiagnosticError} from '../../api/tests/whatsapp-operator-delivery-diagnostics.mjs';

const directory=dirname(fileURLToPath(import.meta.url)),dashboard=resolve(directory,'..');
const origin=assertLocalServiceOrigin('http://127.0.0.1:5187');
const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixture WhatsApp local</title><style>body{margin:0;font:16px/1.6 system-ui;background:#edf1ef;color:#162b22}main{max-width:620px;margin:40px auto;padding:28px;background:white;border-radius:12px}strong{display:block;font-size:13px;color:#385545}h1{font-size:24px}button{padding:12px 18px;background:#167848;color:white;border:0;border-radius:7px;font:inherit;cursor:pointer}p{max-width:60ch}output{display:block;margin-top:24px}@media(max-width:640px){main{margin:16px;padding:24px}}</style><main><strong>Fixture local de teste · Sem conexão com a Meta</strong><h1>WhatsApp</h1><p>Este ambiente prepara os testes de produtos e agendamentos com a API e o banco locais. As jornadas serão adicionadas nas tarefas seguintes.</p><button id="check">Verificar API local</button><output id="result" aria-live="polite">Aguardando verificação.</output></main><script>document.getElementById('check').onclick=async()=>{const target=document.getElementById('result');try{const response=await fetch('/v1/ready');const data=await response.json();if(!response.ok||data.status!=='ready')throw Error();target.textContent='API local pronta. Banco conectado.';}catch{target.textContent='API local indisponível.';}};</script></html>`;

export default async function setup(options={}){
  const previousEnvironment=process.env;
  process.env=serviceBrowserEnvironment(previousEnvironment);
  let runtime,server,conversationFixtures,installConversationFixture;
  const close=async()=>{
    const errors=[];
    try{await server?.close();}catch(error){errors.push(error);}
    try{if(conversationFixtures)await conversationFixtures.close();else await runtime?.close();}catch(error){
      // Existing bounded/redacted observer only; preserve this same failure.
      observeProviderTrapFailure(error);
      try{
        let nodes=0;const names=new Set(['Error','AggregateError','AssertionError','AbortError','TypeError','TimeoutError']);
        const safe=(value,depth)=>{
          nodes++;const message=typeof value?.message==='string'?value.message.slice(0,1024):'';
          const result={name:names.has(value?.name)?value.name:'Error',codes:[...new Set(message.match(/\b(?:service_[a-z0-9_]+|ERR_[A-Z0-9_]+)\b/g)??[])].filter(code=>code.length<=96).slice(0,3),
            ...(typeof value?.actual==='number'||typeof value?.actual==='boolean'?{actual:value.actual}:{}),...(typeof value?.expected==='number'||typeof value?.expected==='boolean'?{expected:value.expected}:{})};
          result.known=operatorDiagnosticError(value);
          const nodeCodes=new Set(['ERR_ASSERTION','ERR_CHILD_PROCESS_STDIO_MAXBUFFER','ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENOENT','EAGAIN','ENOMEM','ABORT_ERR']);
          if(nodeCodes.has(value?.code)||(Number.isSafeInteger(value?.code)&&value.code>=0&&value.code<=255))result.code=value.code;
          if(['SIGTERM','SIGKILL','SIGABRT'].includes(value?.signal))result.signal=value.signal;
          if(typeof value?.killed==='boolean')result.killed=value.killed;
          const command=message.match(/\bdocker(?:\.exe)?(?: --context [A-Za-z0-9_.-]+)? (inspect|rm|ps)\b/);
          if(command)result.dockerPhase=command[1];
          if(/No such (?:object|container)/i.test(String(value?.stderr??'')))result.ownedTargetMissing=true;
          const frames=String(value?.stack??'').split('\n').slice(1,9).flatMap(line=>{
            const match=line.replaceAll('\\','/').match(/\/(apps\/(?:api\/tests|dashboard\/e2e)\/[A-Za-z0-9_./-]+\.mjs):([1-9]\d{0,5})(?::\d{1,5})?/);
            return match&&!match[1].split('/').includes('..')?[{path:match[1],line:Number(match[2])}]:[];
          }).slice(0,6);if(frames.length)result.frames=frames;
          if(depth<3&&Array.isArray(value?.errors)){
            const errors=[];for(const child of value.errors){if(nodes>=6)break;errors.push(safe(child,depth+1));}if(errors.length)result.errors=errors;
          }
          return result;
        };
        console.error('service_browser_cleanup_diagnostic',JSON.stringify(safe(error,0)));
      }catch{/* Diagnostics never replace the original cleanup failure. */}
      errors.push(error);
    }
    process.env=previousEnvironment;
    if(errors.length)throw new AggregateError(errors,'service_browser_cleanup_failed');
  };
  try{
    if(options.whatsappConversations===true){
      const conversations=await import('./service-whatsapp-conversations-fixture.mjs');
      conversationFixtures=await conversations.prepareWhatsAppConversationFixtures();
      installConversationFixture=conversations.installWhatsAppConversationFixture;
      runtime=conversationFixtures.runtime;
    }else runtime=await createServiceTestRuntime({local:true});
    console.log('Local service runtime startup:',JSON.stringify(runtime.evidence().startupTimings));
    assertLocalServiceOrigin(runtime.apiOrigin);
    const entitlementFixtures=options.catalogEntitlements===true?await prepareCatalogEntitlementFixtures(runtime):undefined;
    const attendanceFixtures=options.attendance===true?await prepareAttendanceFixtures(runtime):undefined;
    const professionalFixtures=options.professionals===true?await prepareProfessionalFixtures(runtime):undefined;
    const categoryFixtures=options.categories===true?await prepareCategoryFixtures(runtime):undefined;
    const catalogProfessionalFixtures=options.catalogProfessionals===true?await prepareCatalogProfessionalFixtures(runtime):undefined;
    process.env.VITE_API_BASE_URL=origin;
    process.env.SERVICE_LOCAL_ORIGIN=origin;
    process.env.SERVICE_LOCAL_RUN_ID=runtime.db.runId;
    const plugin={name:'service-local-owned-fixtures',configureServer(vite){
      installCompanyFixture(vite,runtime);
      installCompanyServicesFixture(vite,runtime);
      installCatalogBusinessModeFixture(vite,runtime);
      if(conversationFixtures)installConversationFixture(vite,conversationFixtures);
      if(entitlementFixtures)installCatalogEntitlementFixture(vite,runtime,entitlementFixtures);
      if(attendanceFixtures)installAttendanceFixture(vite,runtime,attendanceFixtures);
      if(professionalFixtures)installProfessionalFixture(vite,runtime,professionalFixtures);
      if(categoryFixtures)installCategoryFixture(vite,runtime,categoryFixtures);
      if(catalogProfessionalFixtures)installCatalogProfessionalFixture(vite,runtime,catalogProfessionalFixtures);
      vite.middlewares.use((request,response,next)=>{
        if(request.url==='/__service/signup-oauth'&&request.method==='POST'){
          // Owned synthetic pending-OAuth state. No OAuth provider is contacted.
          void(async()=>{
            const email='t10-oauth@example.test',password='SyntheticPassword123!';
            const registered=await fetch(runtime.apiOrigin+'/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({merchant_name:'OAuth Sintético',email,password,business_mode:'products'})});
            if(!registered.ok)throw Error('synthetic_signup_seed_failed');
            const auth=await registered.json();
            const owner=await fetch(runtime.apiOrigin+'/auth/me',{method:'PUT',headers:{'content-type':'application/json',authorization:'Bearer '+auth.access_token},body:JSON.stringify({name:'Pessoa Sintética OAuth',phone:'11999999999'})});
            if(!owner.ok)throw Error('synthetic_signup_owner_seed_failed:'+owner.status);
            const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
            await runtime.db.sql(`UPDATE merchants SET business_mode_selected_at=NULL,store_settings=coalesce(store_settings,'{}'::jsonb)||'{"registration_pending":true,"oauth_registration_pending":true}'::jsonb WHERE id=${literal(auth.merchant_id)};`);
            response.setHeader('Content-Type','application/json');response.end(JSON.stringify({email,password,access_token:auth.access_token}));
          })().catch(()=>{response.statusCode=500;response.end('synthetic_signup_seed_failed');});return;
        }
        if(request.url==='/__service/manifest'){
          response.setHeader('Content-Type','application/json');response.end(JSON.stringify({origin,apiOrigin:runtime.apiOrigin,
            runId:runtime.db.runId,kind:'local-owned',metaConnected:false,pspConnected:false}));return;
        }
        if(request.url==='/__service/whatsapp'){
          response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);return;
        }
        next();
      });
    }};
    server=await createServer({root:dashboard,configFile:resolve(dashboard,'vite.config.ts'),envFile:false,
      clearScreen:false,logLevel:'error',plugins:[plugin],
      define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify(origin)},
      ...(conversationFixtures?{optimizeDeps:{entries:['e2e/fixtures/whatsapp-conversation.tsx']}}:{}),
      server:{host:'127.0.0.1',port:5187,strictPort:true,
        proxy:{'/v1':{target:runtime.apiOrigin,changeOrigin:false},
          ...(conversationFixtures?{'/socket.io':{target:runtime.apiOrigin,changeOrigin:false,ws:true}}:{})}}});
    await server.listen();
    return close;
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'service_browser_setup_cleanup_failed');}throw error;}
}
