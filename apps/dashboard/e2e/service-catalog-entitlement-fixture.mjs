import {randomUUID} from 'node:crypto';

const sqlText=value=>"'"+String(value).replaceAll("'","''")+"'";

/** Real owned preconditions finish before UI server readiness, inside existing setup bounds. */
export async function prepareCatalogEntitlementFixtures(runtime){
  const scenarios=new Map(),fixtures=new Map();
  for(const [mode,plan]of [['products','starter'],['services','starter'],['products','growth']]){
    const phase=async(stage,work)=>{
      const started=Date.now();
      try{const result=await work();console.log('service_t107_seed_phase',JSON.stringify({mode,plan,stage,elapsedMs:Date.now()-started,...(typeof result?.status==='number'?{status:result.status}:{})}));return result;}
      catch(error){console.error('service_t107_seed_phase',JSON.stringify({mode,plan,stage,elapsedMs:Date.now()-started,error:typeof error?.name==='string'?error.name:'unknown'}));throw error;}
    };
      const suffix=randomUUID(),email=`t107-${mode}-${plan}-${suffix}@example.test`,password='SyntheticPassword123!';
      const registered=await phase('register',()=>fetch(runtime.apiOrigin+'/auth/register',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({merchant_name:`Empresa local ${mode} ${plan} T107`,email,password,business_mode:mode})}));
      if(!registered.ok)throw Error('synthetic_entitlement_registration_failed:'+registered.status);
      const auth=await registered.json(),merchantId=auth.merchant_id;
      if(typeof auth.user_id!=='string'||!auth.user_id)throw Error('synthetic_entitlement_owner_required');
      const settings={registration_pending:false,oauth_registration_pending:false,plan_selection_pending:false,company:{razaoSocial:'Empresa sintética T107'},businessHours:[]};
      const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
      // Declare this fixture's plan before its first browser session. Never change a
      // non-entitled test company to conceal an unsupported endpoint request.
      await phase('declare',()=>runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug=${sqlText('entitlement-'+suffix)},store_settings=${sqlText(JSON.stringify(settings))}::jsonb WHERE id=${sqlText(merchantId)};
        INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES (${sqlText(merchantId)},${sqlText(JSON.stringify(steps))}::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();
        INSERT INTO merchant_billing_subscriptions(merchant_id,status,plan_key,current_period_end,trial_ends_at,updated_at) VALUES (${sqlText(merchantId)},'active',${sqlText(plan)},now()+interval '30 days',NULL,now()) ON CONFLICT(merchant_id) DO UPDATE SET status=EXCLUDED.status,plan_key=EXCLUDED.plan_key,current_period_end=EXCLUDED.current_period_end,trial_ends_at=NULL,updated_at=now();
        INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES (${sqlText(merchantId)},'[]'::jsonb,1,${sqlText(auth.user_id)},now()) ON CONFLICT(merchant_id) DO UPDATE SET grants=EXCLUDED.grants,updated_by=EXCLUDED.updated_by,updated_at=now();`));
      const headers={authorization:'Bearer '+auth.access_token,'content-type':'application/json','idempotency-key':randomUUID()};
      const checkout=await phase('checkout',()=>fetch(runtime.apiOrigin+'/checkout-settings',{method:'GET',headers:{authorization:headers.authorization},signal:AbortSignal.timeout(10000)}));
      if(checkout.status!==200)throw Error('synthetic_entitlement_checkout_failed:'+checkout.status);
      const defaults=await checkout.json();
      if(defaults.merchantId!==merchantId||!Array.isArray(defaults.advancedRules)||defaults.advancedRules.length!==0)throw Error('synthetic_entitlement_checkout_defaults_required');
      const persisted=await phase('checkout-read',()=>runtime.db.sql(`SELECT count(*) FROM checkout_settings WHERE merchant_id=${sqlText(merchantId)} AND advanced_rules='[]'::jsonb;`));
      if(persisted.trim()!=='1')throw Error('synthetic_entitlement_checkout_persistence_required');
      const name=`Oferta ${mode} ${plan} T107`,sku=`t107-${suffix}`;
      const created=await phase('create',()=>fetch(runtime.apiOrigin+`/merchants/${merchantId}/products`,{method:'POST',headers,signal:AbortSignal.timeout(10000),body:JSON.stringify({name,type:mode==='services'?'service':'physical',metadata:mode==='services'?{serviceType:'presencial'}:{},variants:[{sku,basePriceInCents:2500,...(mode==='products'?{weightGrams:100}:{})}]})}));
      if(created.status!==201)throw Error('synthetic_entitlement_product_failed:'+created.status);
      const product=await created.json(),fixtureId=randomUUID();
      fixtures.set(fixtureId,{merchantId,productId:product.id});
      scenarios.set(`${mode}/${plan}`,{email,password,access_token:auth.access_token,merchant_id:merchantId,productId:product.id,name,sku,mode,plan,fixtureId});
  }
  return{scenarios,fixtures};
}

/** UI mutations and all SUT responses remain real; this route returns prepared coordinates only. */
export function installCatalogEntitlementFixture(vite,runtime,prepared){
  vite.middlewares.use((request,response,next)=>{
    const creation=/^\/__service\/catalog-entitlements\/(products|services)\/(starter|growth)$/.exec(request.url??'');
    const snapshot=/^\/__service\/catalog-entitlements\/([a-f0-9-]{36})\/snapshot$/.exec(request.url??'');
    if(!((creation&&request.method==='POST')||(snapshot&&request.method==='GET')))return next();
    void(async()=>{
      if(creation){
        const fixture=prepared.scenarios.get(`${creation[1]}/${creation[2]}`);
        if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}
        response.setHeader('Content-Type','application/json');response.end(JSON.stringify(fixture));return;
      }
      const fixture=prepared.fixtures.get(snapshot[1]);
      if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}
      const {merchantId,productId}=fixture;
      const result=await runtime.db.sql(`SELECT json_build_object(
        'product',(SELECT json_build_object('id',id,'type',type,'name',name,'isActive',is_active) FROM products WHERE id=${sqlText(productId)} AND merchant_id=${sqlText(merchantId)}),
        'promotions',coalesce((SELECT json_agg(json_build_object('id',id,'productId',product_id,'discountType',discount_type,'discountValue',discount_value,'isActive',is_active)) FROM product_promotions WHERE merchant_id=${sqlText(merchantId)} AND product_id=${sqlText(productId)}),'[]'::json),
        'rules',coalesce((SELECT advanced_rules FROM checkout_settings WHERE merchant_id=${sqlText(merchantId)}),'[]'::jsonb));`);
      response.setHeader('Content-Type','application/json');response.end(JSON.stringify(JSON.parse(result)));
    })().catch(error=>{response.statusCode=500;response.end(String(error.message));});
  });
}
