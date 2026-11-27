import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const db=new pg.Client({connectionString:'postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback_seed_qa_candidate'});
async function snapshot(){
 await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  const r=(await db.query(`SELECT
   (SELECT count(*)::integer FROM post_sale_message_templates WHERE merchant_id LIKE 'qa-cashback-v1-%') AS templates,
   (SELECT count(*)::integer FROM post_sale_message_templates WHERE merchant_id LIKE 'qa-cashback-v1-%' AND is_active=true) AS active_templates,
   (SELECT count(*)::integer FROM campaign_contact_consents WHERE merchant_id LIKE 'qa-cashback-v1-%' AND status='granted') AS granted_consents,
   (SELECT count(*)::integer FROM merchant_payment_connections WHERE merchant_id LIKE 'qa-cashback-v1-%') AS provider_connections,
   (SELECT count(*)::integer FROM cashback_ledger_entries WHERE merchant_id LIKE 'qa-cashback-v1-%') AS ledger,
   (SELECT count(*)::integer FROM cashback_notifications WHERE merchant_id LIKE 'qa-cashback-v1-%' AND state IN ('sent','dispatching','unknown')) AS unsafe_notification_states`)).rows[0];
  return {at:new Date().toISOString(),...r};
 }finally{await db.query('ROLLBACK');}
}
await db.connect();let before,after;
try{before=await snapshot();await new Promise(resolve=>setTimeout(resolve,60000));after=await snapshot();}
finally{await db.end();}
for(const r of [before,after]){
 assert.equal(r.templates,928);assert.equal(r.active_templates,0);assert.equal(r.granted_consents,0);
 assert.equal(r.provider_connections,0);assert.equal(r.ledger,49);assert.equal(r.unsafe_notification_states,0);
}
assert.ok(Date.parse(after.at)-Date.parse(before.at)>=60000);
const report={environment:'local',runtimeMode:'test',method:'two direct PostgreSQL read-only snapshots after final compiled API restart',
 pass:true,before,after,minimumCycleMs:60000,cashbackLifecycleTimerClaim:false,
 boundary:'CashbackLifecycleJob timer is disabled in test. These observations prove persistent QA isolation, not invocation of that timer. Homologation needs actual skipped notification receipts.'};
writeFileSync('C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence/final-review-isolation-cycle.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:true,elapsedMs:Date.parse(after.at)-Date.parse(before.at),templates:after.templates,activeTemplates:after.active_templates,ledger:after.ledger}));
