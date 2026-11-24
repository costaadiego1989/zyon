import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer,type ViteDevServer} from 'vite';
import {createServiceMetricsHttpFixture} from '../../api/tests/service-metrics-http.fixture.js';
import {companyHttpFixture} from '../../api/tests/service-company-http-fixture.mjs';
import {assertLocalServiceOrigin,serviceBrowserEnvironment} from './service-local-scope.mjs';

const directory=dirname(fileURLToPath(import.meta.url)),dashboard=resolve(directory,'..');
const origin=assertLocalServiceOrigin('http://127.0.0.1:5187');
const quoted=(value:string)=>"'"+value.replaceAll("'","''")+"'";
/** Opt-in test setup only. Reuses the original owned HTTP/SQL fixture and its
 * canonical AppModule; no application/test endpoint, model or guard override. */
export default async function setupServiceOverview(){
 const previousEnvironment=process.env;process.env=serviceBrowserEnvironment(previousEnvironment);
 let fixture:Awaited<ReturnType<typeof createServiceMetricsHttpFixture>>|undefined,server:ViteDevServer|undefined;
 let partial:Awaited<ReturnType<Awaited<ReturnType<typeof createServiceMetricsHttpFixture>>['seedUnclassifiedPayment']>>|undefined;
 let failedColumn=false,closed=false;
 const setSqlFailure=async(enabled:boolean)=>{
  if(!fixture)throw Error('service_overview_fixture_not_ready');
  if(enabled&&!failedColumn){await fixture.runtime.db.sql('ALTER TABLE service_appointments RENAME COLUMN operational_status TO synthetic_overview_unavailable_status;');failedColumn=true;}
  else if(!enabled&&failedColumn){await fixture.runtime.db.sql('ALTER TABLE service_appointments RENAME COLUMN synthetic_overview_unavailable_status TO operational_status;');failedColumn=false;}
 };
 const close=async()=>{
  if(closed)return;closed=true;const errors:unknown[]=[];
  try{await server?.close();}catch(error){errors.push(error);}
  try{await setSqlFailure(false);}catch(error){if(fixture)errors.push(error);}
  try{await partial?.close();partial=undefined;}catch(error){errors.push(error);}
  try{await fixture?.close();}catch(error){errors.push(error);}
  process.env=previousEnvironment;
  if(errors.length)throw new AggregateError(errors,'service_overview_browser_cleanup_failed');
 };
 try{
  fixture=await createServiceMetricsHttpFixture();const owned=fixture,{runtime,prisma}=owned,http=companyHttpFixture(runtime);
  assertLocalServiceOrigin(runtime.apiOrigin);const actual=runtime.evidence();
  assert.equal(actual.canonicalAppModule,true);assert.equal(actual.authOverrides,false);assert.equal(actual.repositoryOverrides,false);assert.equal(actual.providerCalls,0);
  // Reuse the existing local dashboard onboarding/subscription precondition.
  // No production flag, authorization token or completed metric result is seeded.
  const review=await http.register('metrics-review-'+randomUUID()+'@example.test','services');
  await prisma.merchant.update({where:{id:review.merchant_id},data:{plan:'BOTH',businessModeNeedsReview:true}});
  for(const auth of [owned.services,owned.products,review]){
   const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
   await runtime.db.sql("UPDATE merchants SET store_slug="+quoted('overview-'+randomUUID())+",store_settings=coalesce(store_settings,'{}'::jsonb)||'{\"registration_pending\":false,\"oauth_registration_pending\":false,\"plan_selection_pending\":false}'::jsonb WHERE id="+quoted(auth.merchant_id)+";\n"+
    "INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES ("+quoted(auth.merchant_id)+","+quoted(JSON.stringify(steps))+"::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();\n"+
    "INSERT INTO merchant_billing_subscriptions(merchant_id,status,plan_key,current_period_end,trial_ends_at,updated_at) VALUES ("+quoted(auth.merchant_id)+",'active','growth',now()+interval '30 days',NULL,now()) ON CONFLICT(merchant_id) DO UPDATE SET status='active',plan_key=EXCLUDED.plan_key,current_period_end=EXCLUDED.current_period_end,trial_ends_at=NULL,updated_at=now();\n"+
    "INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES ("+quoted(auth.merchant_id)+",'[]'::jsonb,1,"+quoted(auth.user_id)+",now()) ON CONFLICT(merchant_id) DO UPDATE SET grants=EXCLUDED.grants,updated_by=EXCLUDED.updated_by,updated_at=now();");
   const checkout=await http.request('/checkout-settings',undefined,auth.access_token,'GET');assert.equal(checkout.status,200);
  }
  const scenarios=new Map<string,Record<string,unknown>>();
  for(const [name,auth,mode,role] of [
   ['services',owned.services,'services','OWNER'],['products',owned.products,'products','OWNER'],
   ['admin',owned.admin,'services','ADMIN'],['staff',owned.staff,'services','STAFF'],['review',review,'services','OWNER']
  ] as const){
   assert.equal(typeof auth.user_id,'string');const user=await prisma.merchantUser.findUniqueOrThrow({where:{id:auth.user_id!}});
   assert.ok(user.email.endsWith('@example.test'));
   scenarios.set(name,{fixtureId:randomUUID(),email:user.email,password:'SyntheticPassword123!',merchant_id:auth.merchant_id,user_id:user.id,mode,role,
    professionalA:owned.ids.professionalA,professionalB:owned.ids.professionalB,categoryA:owned.ids.categoryA,categoryB:owned.ids.categoryB,fromDate:'2026-11-19',emptyDate:'2026-11-17',review:name==='review'});
  }
  const plugin={name:'service-overview-owned-sql-fixture',configureServer(vite:ViteDevServer){
   vite.middlewares.use((request,response,next)=>{
    if(!request.url?.startsWith('/__service/overview/'))return next();
    // Literal run-owned commands only. Never accepts SQL, IDs, credentials,
    // business results or arbitrary state from a browser body.
    const seed=/^\/__service\/overview\/seed\/(services|products|admin|staff|review)$/.exec(request.url);
    const command=/^\/__service\/overview\/control\/(partial-on|partial-off|sql-failure-on|sql-failure-off)$/.exec(request.url);
    const snapshot=request.url==='/__service/overview/snapshot'&&request.method==='GET';
    const evidence=request.url==='/__service/overview/evidence'&&request.method==='GET';
    if((seed||command)&&request.method!=='POST'||!seed&&!command&&!snapshot&&!evidence){response.statusCode=404;response.end('unknown_owned_overview_fixture');return;}
    if(request.headers.origin&&request.headers.origin!==origin){response.statusCode=403;response.end('owned_overview_origin_required');return;}
    void(async()=>{
     let value:unknown;
     if(seed)value=scenarios.get(seed[1]);
     else if(command){
      switch(command[1]){
       case 'partial-on':assert.equal(partial,undefined,'service_overview_partial_already_active');partial=await owned.seedUnclassifiedPayment();break;
       case 'partial-off':await partial?.close();partial=undefined;break;
       case 'sql-failure-on':await setSqlFailure(true);break;
       case 'sql-failure-off':await setSqlFailure(false);break;
      }
      value={ok:true};
     }else if(snapshot)value=await owned.snapshot();
     else{const current=runtime.evidence();value={canonicalAppModule:current.canonicalAppModule,authOverrides:current.authOverrides,repositoryOverrides:current.repositoryOverrides,providerCalls:current.providerCalls,production:false};}
     response.setHeader('content-type','application/json; charset=utf-8');response.setHeader('cache-control','no-store');response.end(JSON.stringify(value));
    })().catch(()=>{response.statusCode=500;response.end('service_overview_owned_fixture_failed');});
   });
  }};
  process.env.VITE_API_BASE_URL=origin;process.env.SERVICE_LOCAL_ORIGIN=origin;process.env.SERVICE_LOCAL_RUN_ID=runtime.db.runId;
  server=await createServer({root:dashboard,configFile:resolve(dashboard,'vite.config.ts'),envFile:false,clearScreen:false,logLevel:'error',plugins:[plugin],
   define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify(origin)},
   server:{host:'127.0.0.1',port:5187,strictPort:true,proxy:{'/v1':{target:runtime.apiOrigin,changeOrigin:false}}}});
  await server.listen();return close;
 }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'service_overview_browser_setup_cleanup_failed');}throw error;}
}
