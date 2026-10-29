import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import Stripe from "stripe";

// A real provider TEST transaction, not a mocked webhook, and never a live charge.
if (process.argv[2] !== "--execute-test-payment") throw new Error("explicit_test_payment_flag_required");
const project = "b8421237-6557-4677-a08c-c93453b08568", api = "https://api-sandbox-8146.up.railway.app";
const railway = path.join(process.env.APPDATA, "npm/node_modules/@railway/cli/bin/railway.exe");
function command(args) {
  const r = spawnSync(railway, args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`railway_test_operation_failed:${args[0]}`);
  return r.stdout;
}
function ssh(source, data = {}) {
  const encoded = Buffer.from(source).toString("base64"), payload = Buffer.from(JSON.stringify(data)).toString("base64");
  const remote = `node -e 'eval(Buffer.from(process.argv[1],process.argv[2]).toString())' ${encoded} base64 ${payload}`;
  const output = command(["ssh", "-p", project, "-s", "api", "-e", "sandbox", "--", remote]);
  const line = output.split(/\r?\n/).find(line => line.startsWith("RESULT "));
  if (!line) throw new Error("remote_test_result_missing");
  const result = JSON.parse(line.slice(7)); if (result.error) throw new Error(result.error); return result;
}
const config = JSON.parse(command(["variable", "list", "-p", project, "-s", "api", "-e", "sandbox", "--json"]));
assert.ok(config.STRIPE_SECRET_KEY.startsWith("sk_test_"));
const stripe = new Stripe(config.STRIPE_SECRET_KEY, { timeout: 15000, maxNetworkRetries: 0 });
assert.equal((await stripe.accounts.retrieve()).id, "acct_1TVJ9KPvEQVo3vcN");
const credential = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$c=Import-Clixml -LiteralPath (Join-Path $env:LOCALAPPDATA 'Zyon\\homolog\\admin.credential.xml');[pscustomobject]@{email=$c.UserName;password=$c.GetNetworkCredential().Password}|ConvertTo-Json -Compress"], { encoding: "utf8" });
assert.equal(credential.status, 0);
const login = await fetch(`${api}/v1/platform/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: credential.stdout });
assert.equal(login.status, 201); const token = (await login.json()).access_token;
async function admin(path, init = {}) {
  const r = await fetch(`${api}/v1/platform/billing/promotions${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`admin_api_status_${r.status}`); return r.json();
}
const merchantId = `qa-subscription-${randomUUID()}`;
let code = `QA-PAGAMENTO-${Date.now().toString(36).toUpperCase()}`;
const retryId = process.argv[3];
if (retryId && !/^[a-f0-9-]{36}$/.test(retryId)) throw new Error("invalid_qa_retry_id");
const output = path.resolve("../../.audit/billing-promotions-homolog"); await mkdir(output, { recursive: true });
let promotion, subscription;
try {
  const operatorId = randomUUID(), operatorEmail = `qa-billing-${operatorId}@example.test`;
  const operatorPassword = randomBytes(24).toString("base64url"), salt = randomBytes(16).toString("base64url");
  const operatorHash = `scrypt:${salt}:${scryptSync(operatorPassword, salt, 64).toString("base64url")}`;
  ssh(`const {Client}=require('pg');const d=JSON.parse(Buffer.from(process.argv[3],'base64'));(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{await c.query("INSERT INTO platform_operators(id,email,password_hash,role,auth_version,created_at,updated_at) VALUES($1,$2,$3,'billing_ops',0,NOW(),NOW())",[d.id,d.email,d.hash]);console.log('RESULT '+JSON.stringify({created:true}));}finally{await c.end()}})().catch(()=>{console.log('RESULT '+JSON.stringify({error:'qa_readonly_identity_failed'}));process.exitCode=1});`, { id: operatorId, email: operatorEmail, hash: operatorHash });
  try {
    const readonlyLogin = await fetch(`${api}/v1/platform/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: operatorEmail, password: operatorPassword }) });
    assert.equal(readonlyLogin.status, 201); const readonlyToken = (await readonlyLogin.json()).access_token;
    const headers = { Authorization: `Bearer ${readonlyToken}`, "Content-Type": "application/json" };
    assert.equal((await fetch(`${api}/v1/platform/billing/promotions`, { headers })).status, 200);
    for (const [method, suffix] of [["POST", ""], ["PUT", `/${randomUUID()}`], ["PATCH", `/${randomUUID()}`], ["DELETE", `/${randomUUID()}`], ["POST", `/${randomUUID()}/retry`]]) {
      const denied = await fetch(`${api}/v1/platform/billing/promotions${suffix}`, { method, headers, ...(method === "DELETE" ? {} : { body: "{}" }) });
      assert.equal(denied.status, 403, `readonly_${method}_must_be_forbidden`);
    }
    await fetch(`${api}/v1/platform/auth/logout`, { method: "POST", headers });
    console.log(JSON.stringify({ readonlyRole: "billing_ops", read: 200, allFiveWriteRoutes: 403 }));
  } finally {
    ssh(`const {Client}=require('pg');const d=JSON.parse(Buffer.from(process.argv[3],'base64'));(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query('DELETE FROM platform_operators WHERE id=$1 AND email=$2',[d.id,d.email]);console.log('RESULT '+JSON.stringify({removed:r.rowCount}));}finally{await c.end()}})().catch(()=>{console.log('RESULT '+JSON.stringify({error:'qa_readonly_identity_cleanup_failed'}));process.exitCode=1});`, { id: operatorId, email: operatorEmail });
  }
  const seeded = ssh(`const {Client}=require('pg');const d=JSON.parse(Buffer.from(process.argv[3],'base64'));(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{await c.query("INSERT INTO merchants(id,name,plan,created_at,updated_at) VALUES($1,$2,'BOTH',NOW(),NOW())",[d.id,'TESTE AUTOMATICO - assinatura homologacao']);console.log('RESULT '+JSON.stringify({created:true}));}finally{await c.end()}})().catch(()=>{console.log('RESULT '+JSON.stringify({error:'qa_merchant_seed_failed'}));process.exitCode=1});`, { id: merchantId });
  assert.equal(seeded.created, true);
  promotion = retryId ? await admin(`/${retryId}/retry`, { method: "POST" }) : await admin("", { method: "POST", body: JSON.stringify({ id: randomUUID(), code, name: "QA automático pagamento de assinatura - TESTE", discountType: "fixed", discountValue: 17800,
    duration: "once", durationMonths: null, plans: ["starter179"], startsAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), maxRedemptions: 1, firstTimeOnly: false }) });
  code = promotion.code;
  const providerPromotion = (await stripe.promotionCodes.list({ code, active: true, limit: 10 })).data[0]; assert.ok(providerPromotion); assert.equal(providerPromotion.livemode, false);
  const customer = await stripe.customers.create({ name: "QA assinatura - HOMOLOGAÇÃO", metadata: { merchant_id: merchantId } });
  const paymentMethod = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethod.id } });
  subscription = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: config.STRIPE_BILLING_PRICE_STARTER_179 }],
    discounts: [{ promotion_code: providerPromotion.id }], metadata: { merchant_id: merchantId }, payment_behavior: "error_if_incomplete", expand: ["latest_invoice"] });
  assert.equal(subscription.livemode, false); assert.equal(subscription.status, "active");
  const invoice = subscription.latest_invoice; assert.equal(typeof invoice, "object"); assert.equal(invoice.status, "paid"); assert.equal(invoice.amount_paid, 100); assert.equal(invoice.currency, "brl");
  console.log(JSON.stringify({ testPayment: "paid", amountCents: invoice.amount_paid, subscriptionId: subscription.id, invoiceId: invoice.id, livemode: false }));
  let evidence;
  for (let attempt = 0; attempt < 20; attempt++) {
    evidence = ssh(`const {Client}=require('pg');const d=JSON.parse(Buffer.from(process.argv[3],'base64'));(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const n=await c.query('SELECT status,provider_message_id,event_id,invoice_id,amount_paid_cents,discount_cents FROM billing_admin_notices WHERE provider=$1 AND subscription_id=$2',['stripe',d.subscription]);const b=await c.query('SELECT status,plan_key,provider FROM merchant_billing_subscriptions WHERE merchant_id=$1',[d.merchant]);console.log('RESULT '+JSON.stringify({notice:n.rows[0]||null,noticeCount:n.rowCount,billing:b.rows[0]||null}));}finally{await c.end()}})().catch(()=>{console.log('RESULT '+JSON.stringify({error:'qa_evidence_lookup_failed'}));process.exitCode=1});`, { subscription: subscription.id, merchant: merchantId });
    if (evidence.notice?.status === "sent") break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(evidence.billing?.status, "active"); assert.equal(evidence.billing?.plan_key, "starter179");
  assert.equal(evidence.noticeCount, 1); assert.equal(evidence.notice.status, "sent"); assert.ok(evidence.notice.provider_message_id);
  assert.equal(evidence.notice.amount_paid_cents, 100); assert.equal(evidence.notice.discount_cents, 17800);
  // Replay the real provider event to exercise application idempotency, without claiming a provider-origin replay.
  const originalEvent = await stripe.events.retrieve(evidence.notice.event_id);
  assert.equal(originalEvent.type, "invoice.paid"); assert.equal(originalEvent.data.object.id, invoice.id);
  const payload = JSON.stringify(originalEvent);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: config.STRIPE_WEBHOOK_SECRET });
  const replay = await fetch(`${api}/v1/webhooks/stripe`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": signature }, body: payload });
  assert.ok(replay.ok); const replayBody = await replay.json(); assert.ok(JSON.stringify(replayBody).includes("duplicate"));
  const delivery = ssh(`const {Client}=require('pg');const d=JSON.parse(Buffer.from(process.argv[3],'base64'));(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query('SELECT provider_message_id,status FROM billing_admin_notices WHERE subscription_id=$1',[d.subscription]);let event=null;const response=await fetch('https://api.resend.com/emails/'+encodeURIComponent(r.rows[0].provider_message_id),{headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY}});if(response.ok){const email=await response.json();event=email.last_event||null;}console.log('RESULT '+JSON.stringify({count:r.rowCount,status:r.rows[0].status,messageId:r.rows[0].provider_message_id,providerReadStatus:response.status,lastEmailEvent:event}));}finally{await c.end()}})().catch(()=>{console.log('RESULT '+JSON.stringify({error:'qa_email_evidence_failed'}));process.exitCode=1});`, { subscription: subscription.id });
  assert.equal(delivery.count, 1); assert.equal(delivery.messageId, evidence.notice.provider_message_id);
  const result = { proof: "real_stripe_test_payment_and_provider_webhook", environment: "sandbox", livemode: false,
    amountPaidCents: 100, discountCents: 17800, merchantId, subscriptionId: subscription.id, invoiceId: invoice.id,
    eventId: evidence.notice.event_id, notification: delivery, controlledReplay: "duplicate", userCouponConsumed: false,
    readonlyRoleGuard: { read: 200, write: 403, testedWriteRoutes: 5, temporaryOperatorRemoved: true },
    inboxConfirmedByUser: false, source: "Stripe API test payment; not a browser checkout completion" };
  await writeFile(path.join(output, "payment-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (subscription) { await stripe.subscriptions.cancel(subscription.id); console.log(JSON.stringify({ testSubscriptionCancelled: subscription.id, liveCharge: false })); }
  if (promotion) await admin(`/${promotion.id}`, { method: "DELETE" });
  await fetch(`${api}/v1/platform/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}
