const sqlText=value=>"'"+String(value).replaceAll("'","''")+"'";

/** Test-only Vite fixture. All writes use the owned local runtime. */
export function installCompanyFixture(vite,runtime){
  vite.middlewares.use((request,response,next)=>{
    if(request.url!=='/__service/company-about'||request.method!=='POST')return next();
    void(async()=>{
      const email='t16-company@example.test',password='SyntheticPassword123!';
      const registered=await fetch(runtime.apiOrigin+'/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({merchant_name:'Empresa Sintética Local',email,password,business_mode:'products'})});
      if(!registered.ok)throw Error('synthetic_company_seed_failed');
      const auth=await registered.json(),id=sqlText(auth.merchant_id);
      const settings={registration_pending:false,oauth_registration_pending:false,plan_selection_pending:false,
        company:{description:'Apresentação pública sintética para teste local.',razaoSocial:'Empresa Sintética Local',email:'comercial@example.test',address:{city:'Cidade Sintética'}},
        businessHours:[],policies:{terms:'Termos sintéticos locais'}};
      const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
      await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_settings=${sqlText(JSON.stringify(settings))}::jsonb WHERE id=${id};
        INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES (${id},${sqlText(JSON.stringify(steps))}::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();`);
      response.setHeader('Content-Type','application/json');response.end(JSON.stringify({email,password,access_token:auth.access_token,merchant_id:auth.merchant_id}));
    })().catch(()=>{response.statusCode=500;response.end('synthetic_company_seed_failed');});
  });
}
