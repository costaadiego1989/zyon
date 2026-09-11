/** Prepare a reviewable manifest using the application DB; never applies by default.
 * Run inside the Railway private network after building the API:
 * node scripts/migrate-growth-price.mjs --output /tmp/growth-migration.json
 * Apply a reviewed manifest: --apply /tmp/growth-migration.json --journal /tmp/growth-results.jsonl
 * Stripe keeps the billing anchor and creates no prorations. Asaas changes only
 * future unissued invoices; already issued pending invoices are preserved.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import pg from 'pg';
import { BILLING_PLANS } from '@zyon/shared-types';
import { readAsaasConnection } from '../dist/modules/payment/infrastructure/asaas-env.js';
import { stripeMigrationDecision, asaasMigrationDecision } from './billing-price-migration-policy.mjs';

const args = process.argv.slice(2), argument = flag => args.includes(flag) ? args[args.indexOf(flag)+1] : undefined;
const applyPath = argument('--apply'), output = argument('--output'), journal = argument('--journal');
if (applyPath && !journal) throw new Error('Apply requires --journal for an append-only recovery record.');
if (!applyPath && !output) throw new Error('Audit requires --output for the reviewable migration manifest.');
const targetValue = BILLING_PLANS.growth.monthlyPriceBrl, targetId = process.env.STRIPE_BILLING_PRICE_GROWTH;
const oldIds = (process.env.STRIPE_BILLING_PRICE_GROWTH_LEGACY || '').split(',').map(v=>v.trim()).filter(Boolean);
const secret = process.env.NODE_ENV === 'production' ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_KEY_TEST;
const stripe = secret ? new Stripe(secret) : undefined, asaas = readAsaasConnection();
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function asaasRequest(id, patch) {
  if (!asaas.apiKey) throw new Error('Asaas key missing.');
  const url = new URL(asaas.baseUrl);
  if (!['api.asaas.com','api-sandbox.asaas.com'].includes(url.hostname)) throw new Error('Use the official Asaas API origin.');
  const res = await fetch(`${asaas.baseUrl}/v3/subscriptions/${encodeURIComponent(id)}`, { method: patch ? 'PUT' : 'GET', headers: { access_token: asaas.apiKey, 'content-type':'application/json', accept:'application/json' }, ...(patch ? { body:JSON.stringify(patch) } : {}), signal:AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Asaas subscription request failed HTTP ${res.status}`);
  return res.json();
}
async function validateTarget() {
  if (!stripe || !targetId) return;
  const price = await stripe.prices.retrieve(targetId, { expand:['product'] });
  const product = price.product;
  if (!price.active || price.unit_amount !== targetValue*100 || price.currency !== 'brl' || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 || product.deleted || (product.metadata.zyon_billing_plan ?? product.metadata.aacp_plan) !== 'growth') throw new Error('Configured Stripe Growth price does not match the shared catalog.');
}
const client = new pg.Client({ connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:15000 });
try {
 await validateTarget(); await client.connect();
 const billingColumns = `merchant_id AS "merchantId", provider, plan_key AS "planKey", status, stripe_subscription_id AS "stripeSubscriptionId", stripe_price_id AS "stripePriceId", asaas_subscription_id AS "asaasSubscriptionId", pending_plan_key AS "pendingPlanKey", cancel_at_period_end AS "cancelAtPeriodEnd"`;
 const rows = (await client.query(`SELECT ${billingColumns} FROM merchant_billing_subscriptions WHERE plan_key = 'growth' OR stripe_price_id = ANY($1::text[]) OR (asaas_subscription_id IS NOT NULL AND plan_key IS NULL)`, [[...oldIds,targetId].filter(Boolean)])).rows;
 const entries = [];
 for (const billing of rows) {
   if (billing.provider === 'stripe' && billing.stripeSubscriptionId) {
     if (!stripe || !targetId) throw new Error('Stripe missing for an existing subscription.');
     const sub = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId);
     const decision = billing.pendingPlanKey || billing.cancelAtPeriodEnd ? { skip:'pending_lifecycle_change' } : stripeMigrationDecision(sub, oldIds, targetId);
     entries.push({ merchantId:billing.merchantId, provider:'stripe', subscriptionId:sub.id, databaseFingerprint:fingerprint(billing), ...decision });
   } else if (billing.provider === 'asaas' && billing.asaasSubscriptionId) {
     const sub = await asaasRequest(billing.asaasSubscriptionId);
     entries.push({ merchantId:billing.merchantId, provider:'asaas', subscriptionId:sub.id, databaseFingerprint:fingerprint(billing), ...asaasMigrationDecision(sub,billing,targetValue) });
   } else entries.push({ merchantId:billing.merchantId, provider:billing.provider, skip:'no_provider_subscription' });
 }
 const manifest = { version:1, createdAt:new Date().toISOString(), targetValue, targetId, oldIds, environment:process.env.NODE_ENV, asaasSandbox:asaas.sandbox, entries };
 if (!applyPath) { if(output==='-') console.log('BILLING_GROWTH_MIGRATION '+JSON.stringify(manifest)); else writeFileSync(output,JSON.stringify(manifest,null,2),{flag:'wx'}); console.log(JSON.stringify({mode:'dry-run',targetValue,total:entries.length,ready:entries.filter(e=>e.patch).length,skipped:entries.filter(e=>e.skip).length,output})); }
 else {
   const approved = JSON.parse(readFileSync(applyPath,'utf8'));
   const age = Date.now()-Date.parse(approved.createdAt);
   if (approved.version !== 1 || approved.targetValue !== targetValue || approved.targetId !== targetId || approved.environment !== process.env.NODE_ENV || approved.asaasSandbox !== asaas.sandbox || !Number.isFinite(age) || age<0 || age>86400000) throw new Error('Manifest target/environment changed or audit is older than 24 hours. Run audit again.');
   for (const entry of approved.entries.filter(e=>e.patch)) {
     const current = entries.find(e=>e.provider===entry.provider && e.subscriptionId===entry.subscriptionId);
     if (current?.skip==='already_current') { appendFileSync(journal,JSON.stringify({at:new Date().toISOString(),subscriptionId:entry.subscriptionId,status:'already_current'})+'\n');continue; }
     if (!current || fingerprint(current)!==fingerprint(entry)) throw new Error(`Subscription changed since audit: ${entry.subscriptionId}`);
     await client.query('BEGIN');
     const locked = (await client.query(`SELECT ${billingColumns} FROM merchant_billing_subscriptions WHERE merchant_id=$1 FOR UPDATE`,[entry.merchantId])).rows[0];
     if (!locked || fingerprint(locked)!==entry.databaseFingerprint) throw new Error(`Database changed before apply: ${entry.subscriptionId}`);
     const fresh = entry.provider==='stripe' ? stripeMigrationDecision(await stripe.subscriptions.retrieve(entry.subscriptionId),oldIds,targetId) : asaasMigrationDecision(await asaasRequest(entry.subscriptionId),locked,targetValue);
     if (fingerprint(fresh.patch)!==fingerprint(entry.patch)) throw new Error(`Provider changed before apply: ${entry.subscriptionId}`);
     appendFileSync(journal,JSON.stringify({at:new Date().toISOString(),status:'applying',...entry})+'\n');
     if (entry.provider==='stripe') {
       const result = await stripe.subscriptions.update(entry.subscriptionId,entry.patch,{idempotencyKey:`zyon-growth-${entry.subscriptionId}-${targetId}`});
       if (result.items.data[0]?.price.id!==targetId) throw new Error('Stripe price verification failed.');
       await client.query(`UPDATE merchant_billing_subscriptions SET stripe_price_id=$1, updated_at=NOW() WHERE merchant_id=$2 AND stripe_subscription_id=$3 AND stripe_price_id=$4`,[targetId,entry.merchantId,entry.subscriptionId,entry.beforePrice]);
     } else {
       await asaasRequest(entry.subscriptionId,entry.patch);
       if ((await asaasRequest(entry.subscriptionId)).value!==targetValue) throw new Error('Asaas value verification failed.');
     }
     await client.query('COMMIT');
     appendFileSync(journal,JSON.stringify({at:new Date().toISOString(),status:'verified',subscriptionId:entry.subscriptionId,targetValue})+'\n');
   }
   console.log(JSON.stringify({mode:'apply',journal}));
 }
} catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; } finally { await client.end(); }
