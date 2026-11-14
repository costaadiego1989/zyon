import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

// Independent, read-only post-UI check. No application code, seed, transaction
// mutation, remote target, auth material or raw request headers are loaded.
const evidence = 'C:/Users/Admin/Desktop/AACP/.specs/features/cashback-release/evidence/';
const walletEvidence = JSON.parse(readFileSync(evidence + 'browser-candidate-widget/results.json', 'utf8'));
const proxyEvidence = JSON.parse(readFileSync(evidence + 'candidate-storefront-embed-proxy.json', 'utf8'));
assert.equal(walletEvidence.passed, 2); assert.equal(walletEvidence.failed, 0);
assert.equal(walletEvidence.businessMocks, false); assert.equal(walletEvidence.walletRestored, true);
assert.equal(proxyEvidence.passed, 3); assert.equal(proxyEvidence.failed, 0);
assert.equal(proxyEvidence.businessMocks, false);
const sessionId = 'chk_embed_062d4cbc69303b559547b5f21208999f8f41a2f44dd1c4c14589c3a27eaab251';
const merchantId = 'qa-cashback-v1-specific', buyerId = 'qa-cashback-v1-buyer-canonical';
const db = new pg.Client({ connectionString: 'postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback_seed_qa_candidate' });
const checks = [];
async function probe(name, work) {
  try { await work(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, reason: String(error.message).slice(0, 400) }); }
}
await db.connect();
let ledger, reservations, balance;
try {
 await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const allLedger = (await db.query("SELECT id,merchant_id,buyer_id,type,amount_cents::text,session_id FROM cashback_ledger_entries WHERE merchant_id LIKE 'qa-cashback-v1-%' ORDER BY id")).rows;
 ledger = allLedger.filter(r => r.session_id === sessionId);
 reservations = (await db.query('SELECT id,session_id,state,data FROM cashback_reservations WHERE merchant_id=$1 AND buyer_id=$2 AND data->>\'sessionId\'=$3 ORDER BY id', [merchantId,buyerId,sessionId])).rows;
 balance = (await db.query('SELECT balance FROM cashback_wallets WHERE merchant_id=$1 AND buyer_id=$2', [merchantId,buyerId])).rows[0]?.balance;
 await probe('the six documented UI ledger rows are the only increase over 43 seeded rows', async () => {
  assert.equal(allLedger.length, 49); assert.equal(ledger.length, 6);
  assert.equal(allLedger.filter(r => r.session_id !== sessionId).length, 43);
 });
 await probe('all six movements have the seeded canonical buyer and exact 1000-cent amount', async () => {
  for (const row of ledger) { assert.equal(row.merchant_id,merchantId); assert.equal(row.buyer_id,buyerId); assert.equal(row.amount_cents,'1000'); }
  assert.deepEqual(ledger.map(r => r.type).sort(), ['reserve','reserve','reserve','unreserve','unreserve','unreserve']);
 });
 await probe('all three new reservations are released and none owns a payment', async () => {
  assert.equal(reservations.length,3);
  for(const row of reservations) { assert.equal(row.session_id,sessionId); assert.equal(row.state,'released'); assert.equal(row.data.state,'released'); assert.equal(row.data.amountCents,1000); assert.ok(!row.data.paymentKey); }
 });
 await probe('canonical wallet is restored to 3500 available and 1500 still pending in the frozen purchase', async () => {
  assert.ok(balance); assert.equal(balance.availableCents,3500); assert.equal(balance.reservedCents,1500); assert.equal(balance.pendingCents,0);
 });
 await probe('UI reserve/remove did not create a payment or a completed order', async () => {
  for (const table of ['payment_intents','completed_orders']) {
   const rows = (await db.query(`SELECT count(*)::integer AS count FROM ${table} WHERE merchant_id=$1 AND session_id=$2`,[merchantId,sessionId])).rows;
   assert.equal(rows[0].count,0,table);
  }
 });
} finally { await db.query('ROLLBACK'); await db.end(); }
const report = { environment:'local',database:'cashback_seed_qa_candidate',method:'direct PostgreSQL REPEATABLE READ READ ONLY; compare documented real UI operations; no source imports or writes',
 pass:checks.length===5 && checks.every(c=>c.pass), checks, expectedSeedLedger:43, expectedUIAdditionalRows:6,
 snapshotSha256:createHash('sha256').update(JSON.stringify({ledger,reservations,balance})).digest('hex') };
writeFileSync(evidence+'final-review-ui-ledger.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,passed:checks.filter(c=>c.pass).length,total:checks.length}));
process.exitCode=report.pass?0:1;
