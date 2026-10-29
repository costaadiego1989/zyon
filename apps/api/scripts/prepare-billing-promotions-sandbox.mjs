import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { parse } from "dotenv";
import path from "node:path";
import Stripe from "stripe";

// Explicitly sandbox-only. Credentials are read locally, sent on stdin, and never logged.
const project = "b8421237-6557-4677-a08c-c93453b08568";
const service = "api";
const apiOrigin = "https://api-sandbox-8146.up.railway.app";
const credentialsPath = process.argv[2];
if (!credentialsPath) throw new Error("Pass the local environment file path; do not pass secret values.");
const railway = process.platform === "win32" ? path.join(process.env.APPDATA, "npm/node_modules/@railway/cli/bin/railway.exe") : "railway";
function command(args, input) {
  const result = spawnSync(railway, args, { input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`railway_operation_failed:${args[0]}`);
  return result.stdout;
}
function variables() {
  return JSON.parse(command(["variable", "list", "--json", "--project", project, "--service", service, "--environment", "sandbox"]));
}
function setVariable(name, value) {
  command(["variable", "set", name, "--stdin", "--skip-deploys", "--project", project, "--service", service, "--environment", "sandbox"], String(value));
  console.log(JSON.stringify({ configured: name, environment: "sandbox" }));
}
function ssh(environment, source, data = {}) {
  const encoded = Buffer.from(source).toString("base64");
  const payload = Buffer.from(JSON.stringify(data)).toString("base64");
  const remote = `node -e 'eval(Buffer.from(process.argv[1],process.argv[2]).toString())' ${encoded} base64 ${payload}`;
  const output = command(["ssh", "--project", project, "--service", service, "--environment", environment, "--", remote]);
  const line = output.split(/\r?\n/).find(line => line.startsWith("RESULT "));
  if (!line) throw new Error("remote_result_missing");
  const result = JSON.parse(line.slice(7));
  if (result.error) throw new Error(result.error);
  return result;
}

const local = parse(readFileSync(credentialsPath));
const key = local.STRIPE_SECRET_KEY_TEST?.trim();
const publishable = local.STRIPE_PUBLISHABLE_KEY_TEST?.trim();
if (!key?.startsWith("sk_test_") || !publishable?.startsWith("pk_test_")) throw new Error("test_keys_required");
const stripe = new Stripe(key, { timeout: 15000, maxNetworkRetries: 1 });
const account = await stripe.accounts.retrieve();
if (account.id !== "acct_1TVJ9KPvEQVo3vcN") throw new Error("unexpected_sandbox_account");
const configured = variables();

const prices = await stripe.prices.list({ active: true, type: "recurring", limit: 100 });
const priceFor = (amount, interval) => prices.data.find(price => !price.livemode && price.currency === "brl" && price.unit_amount === amount && price.recurring?.interval === interval && price.recurring?.usage_type === "licensed");
let starter = priceFor(17900, "month");
let starterAnnual = priceFor(182580, "year");
let productId = starter?.product;
if (!productId) {
  const products = await stripe.products.list({ active: true, limit: 100 });
  productId = products.data.find(product => product.metadata.zyon_plan === "starter179")?.id;
  if (!productId) productId = (await stripe.products.create({ name: "Zyon Starter", metadata: { zyon_plan: "starter179", environment: "sandbox" } }, { idempotencyKey: "zyon-starter179-sandbox-product-v1" })).id;
}
if (typeof productId !== "string") throw new Error("unexpected_product_shape");
if (!starter) starter = await stripe.prices.create({ product: productId, currency: "brl", unit_amount: 17900, recurring: { interval: "month" }, metadata: { zyon_plan: "starter179" } }, { idempotencyKey: "zyon-starter179-sandbox-monthly-v1" });
if (!starterAnnual) starterAnnual = await stripe.prices.create({ product: productId, currency: "brl", unit_amount: 182580, recurring: { interval: "year" }, metadata: { zyon_plan: "starter179" } }, { idempotencyKey: "zyon-starter179-sandbox-annual-v1" });
const selected = {
  STRIPE_BILLING_PRICE_STARTER_179: starter,
  STRIPE_BILLING_PRICE_STARTER_179_ANNUAL: starterAnnual,
  STRIPE_BILLING_PRICE_GROWTH: priceFor(44900, "month"),
  STRIPE_BILLING_PRICE_GROWTH_ANNUAL: priceFor(457980, "year"),
  STRIPE_BILLING_PRICE_SCALE: priceFor(74900, "month"),
  STRIPE_BILLING_PRICE_SCALE_ANNUAL: priceFor(763980, "year"),
};
if (Object.values(selected).some(price => !price || price.livemode)) throw new Error("sandbox_catalog_incomplete");

let webhookSecret = configured.STRIPE_WEBHOOK_SECRET;
let webhookId = configured.STRIPE_BILLING_SANDBOX_WEBHOOK_ID;
if (!webhookId || !webhookSecret) {
  const webhook = await stripe.webhookEndpoints.create({ url: `${apiOrigin}/v1/webhooks/stripe`,
    enabled_events: ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"],
    metadata: { zyon_scope: "billing-promotions-sandbox-20261015" } }, { idempotencyKey: "zyon-billing-promotions-sandbox-webhook-v1" });
  if (webhook.livemode || !webhook.secret) throw new Error("sandbox_webhook_secret_missing");
  webhookId = webhook.id; webhookSecret = webhook.secret;
} else {
  const webhook = await stripe.webhookEndpoints.retrieve(webhookId);
  if (webhook.livemode || webhook.url !== `${apiOrigin}/v1/webhooks/stripe` || webhook.status !== "enabled") throw new Error("sandbox_webhook_mismatch");
}

const admin = ssh("production", `const {Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query("SELECT email FROM platform_operators WHERE role='platform_admin' AND disabled_at IS NULL ORDER BY created_at LIMIT 2");if(r.rows.length!==1)throw new Error('admin_identity_ambiguous');console.log('RESULT '+JSON.stringify({email:r.rows[0].email}));}finally{await c.end()}})().catch(()=>{console.log('RESULT '+JSON.stringify({error:'admin_identity_lookup_failed'}));process.exitCode=1});`);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email)) throw new Error("invalid_admin_identity");

const values = { STRIPE_SECRET_KEY: key, STRIPE_SECRET_KEY_TEST: key, STRIPE_PUBLISHABLE_KEY: publishable, STRIPE_PUBLISHABLE_KEY_TEST: publishable,
  STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_WEBHOOK_SECRET_TEST: webhookSecret, STRIPE_BILLING_SANDBOX_WEBHOOK_ID: webhookId,
  STRIPE_ENABLED: "true", BILLING_PROMOTIONS_ENABLED: "true", BILLING_ADMIN_NOTIFICATION_ENABLED: "true", BILLING_ADMIN_NOTIFICATION_EMAIL: admin.email,
  PLATFORM_CONTROL_JWT_SECRET: configured.PLATFORM_CONTROL_JWT_SECRET || randomBytes(48).toString("base64url"),
  ...Object.fromEntries(Object.entries(selected).map(([name, price]) => [name, price.id])),
};
const allowed = new Set((configured.NOTIFICATION_EMAIL_ALLOWED_RECIPIENTS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
allowed.add(admin.email.toLowerCase()); values.NOTIFICATION_EMAIL_ALLOWED_RECIPIENTS = [...allowed].join(",");
for (const [name, value] of Object.entries(values)) if (configured[name] !== value) setVariable(name, value);

// User-approved separate identity. Never copy a production password/hash.
const existing = ssh("sandbox", `const {Client}=require('pg');const d=JSON.parse(Buffer.from(process.argv[3],'base64'));(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const r=await c.query('SELECT id,role,disabled_at FROM platform_operators WHERE email=$1',[d.email]);console.log('RESULT '+JSON.stringify({exists:r.rows.length>0,eligible:!r.rows.length||(r.rows[0].role==='platform_admin'&&!r.rows[0].disabled_at)}));}finally{await c.end()}})().catch(()=>{console.log('RESULT '+JSON.stringify({error:'sandbox_admin_lookup_failed'}));process.exitCode=1});`, { email: admin.email });
if (!existing.eligible) throw new Error("sandbox_admin_identity_conflict");
if (!existing.exists) {
  if (process.platform !== "win32") throw new Error("windows_secure_credential_store_required");
  const password = randomBytes(32).toString("base64url");
  const salt = randomBytes(16).toString("base64url");
  const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("base64url")}`;
  const saveCredential = `$d=([Console]::In.ReadToEnd()|ConvertFrom-Json);$dir=Join-Path $env:LOCALAPPDATA 'Zyon\\homolog';New-Item -ItemType Directory -Path $dir -Force|Out-Null;$acl=New-Object System.Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule);Set-Acl -LiteralPath $dir -AclObject $acl;$secure=ConvertTo-SecureString $d.password -AsPlainText -Force;$credential=New-Object System.Management.Automation.PSCredential($d.email,$secure);$credential|Export-Clixml -LiteralPath (Join-Path $dir 'admin.credential.xml');`;
  const saved = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", saveCredential], { input: JSON.stringify({ email: admin.email, password }), encoding: "utf8" });
  if (saved.status !== 0) throw new Error("secure_credential_save_failed");
  ssh("sandbox", `const {Client}=require('pg');const d=JSON.parse(Buffer.from(process.argv[3],'base64'));(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();try{await c.query("INSERT INTO platform_operators(id,email,password_hash,role,auth_version,created_at,updated_at) VALUES($1,$2,$3,'platform_admin',0,NOW(),NOW())",[d.id,d.email,d.hash]);console.log('RESULT '+JSON.stringify({created:true}));}finally{await c.end()}})().catch(()=>{console.log('RESULT '+JSON.stringify({error:'sandbox_admin_create_failed'}));process.exitCode=1});`, { id: randomUUID(), email: admin.email, hash });
  console.log(JSON.stringify({ sandboxAdminCreated: true, credential: "%LOCALAPPDATA%\\Zyon\\homolog\\admin.credential.xml", encryptedForCurrentWindowsUser: true }));
}
console.log(JSON.stringify({ sandboxConfigured: true, livemode: false, webhookId, prices: Object.fromEntries(Object.entries(selected).map(([name, price]) => [name, price.id])) }));
