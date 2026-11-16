import {randomUUID} from 'node:crypto';

const sqlText=value=>"'"+String(value).replaceAll("'","''")+"'";

/** Owned synthetic setup only; creation and editing use the real API. */
export function installCatalogBusinessModeFixture(vite,runtime){
  vite.middlewares.use((request,response,next)=>{
    const mode=request.url==='/__service/catalog-products'?'products':request.url==='/__service/catalog-services'?'services':null;
    if(!mode||request.method!=='POST')return next();
    void(async()=>{
      const suffix=randomUUID(),email=`t98-${mode}-${suffix}@example.test`,password='SyntheticPassword123!';
      const registered=await fetch(runtime.apiOrigin+'/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({merchant_name:mode==='services'?'Serviços Sintéticos T98':'Produtos Sintéticos T98',email,password,business_mode:mode})});
      if(!registered.ok)throw Error('synthetic_catalog_seed_failed:'+registered.status);
      const auth=await registered.json();
      const settings={registration_pending:false,oauth_registration_pending:false,plan_selection_pending:false,company:{razaoSocial:'Empresa sintética T98'},businessHours:[]};
      const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
      await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug=${sqlText('catalog-'+suffix)},store_settings=${sqlText(JSON.stringify(settings))}::jsonb WHERE id=${sqlText(auth.merchant_id)};
        INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES (${sqlText(auth.merchant_id)},${sqlText(JSON.stringify(steps))}::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();`);
      response.setHeader('Content-Type','application/json');response.end(JSON.stringify({email,password,access_token:auth.access_token,merchant_id:auth.merchant_id}));
    })().catch(error=>{response.statusCode=500;response.end(String(error.message));});
  });
}
