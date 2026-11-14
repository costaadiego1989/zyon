import fs from 'node:fs';
import pg from 'pg';
// One-time recovery of the incomplete, explicitly owned local QA fixture.
const client=new pg.Client({connectionString:'postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback_seed_qa_candidate'});
await client.connect();
try{
  await client.query('BEGIN');
  const rows=await client.query('SELECT id,merchant_id,buyer_phone,device_id,checkout_session_id FROM whatsapp_sessions WHERE id=$1 FOR UPDATE',['qa-cashback-v1-whatsapp-session']);
  if(rows.rowCount!==1)throw Error('expected_exactly_one_partial_QA_whatsapp_session');
  const row=rows.rows[0];
  if(row.merchant_id!=='qa-cashback-v1-specific'||row.device_id!=='qa-cashback-v1-no-real-device'||!['5500000000001','5520000000000'].includes(row.buyer_phone)||!row.checkout_session_id.startsWith('chk_embed_'))throw Error('QA_scope_collision');
  const before=(await client.query('SELECT count(*)::int AS n,coalesce(sum(amount_cents),0)::text AS amount FROM cashback_ledger_entries')).rows[0];
  await client.query('UPDATE whatsapp_sessions SET buyer_phone=$1 WHERE id=$2 AND merchant_id=$3 AND buyer_phone=$4',['5520000000000',row.id,row.merchant_id,row.buyer_phone]);
  const after=(await client.query('SELECT count(*)::int AS n,coalesce(sum(amount_cents),0)::text AS amount FROM cashback_ledger_entries')).rows[0];
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('unexpected_money_change');
  await client.query('COMMIT');
  fs.writeFileSync('C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence/candidate-seed-phone-constraint-repair.json',JSON.stringify({database:'cashback_seed_qa_candidate',observedErrorCode:'23514',constraint:'buyer_verified_phone_format',qaSessionId:row.id,repairedRows:1,before,after,ledgerUnchanged:true,providerCalls:0},null,2)+'\n');
  console.log(JSON.stringify({qaPhoneSetupRepaired:true,rows:1,ledgerUnchanged:true}));
}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
