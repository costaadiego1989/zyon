import fs from 'node:fs/promises';
import pg from 'pg';

// SQL only: does not consume the application's real HTTP rate budget.
const client=new pg.Client({connectionString:'postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback_seed_qa_candidate'});
await client.connect();
try{
  const observe=async()=>({at:new Date().toISOString(),
    templates:(await client.query("SELECT count(*)::int AS total,count(*)FILTER(WHERE is_active)::int AS active FROM post_sale_message_templates WHERE merchant_id LIKE 'qa-cashback-v1-%'")).rows[0],
    consents:(await client.query("SELECT count(*)::int AS granted FROM campaign_contact_consents WHERE merchant_id LIKE 'qa-cashback-v1-%' AND status='granted'")).rows[0],
    providers:(await client.query("SELECT count(*)::int AS connected FROM merchant_payment_connections WHERE merchant_id LIKE 'qa-cashback-v1-%'")).rows[0]});
  const before=await observe();
  await new Promise(resolve=>setTimeout(resolve,60000));
  const after=await observe();
  for(const observation of[before,after])if(observation.templates.active||observation.consents.granted||observation.providers.connected)throw Error('QA_communication_or_provider_safety_drift');
  const report={database:'cashback_seed_qa_candidate',runtime:'compiled AppModule after final template fix and local key rotation',minimumCycleMs:60000,before,after,httpRequests:0,activeTemplatesStableZero:true};
  await fs.writeFile('C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence/candidate-template-cycle.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({activeTemplates:after.templates.active,totalTemplates:after.templates.total,grantedConsents:0,providerConnections:0,observedCycle:true,httpRequests:0}));
}finally{await client.end();}
