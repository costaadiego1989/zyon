import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { inspectNativePrismaClient,nativePrismaWorkerEnvironment,assertNativePrismaUrl,terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";
import { parseNormalCheckoutPaymentNativeFlags } from "./normal-checkout-payment.guards.mjs";
import { installCheckoutSessionVersionTrigger } from "./checkout-session-version-trigger.mjs";

const coverageMode=parseNormalCheckoutPaymentNativeFlags(process.argv.slice(2));
const apiRoot=fileURLToPath(new URL("../",import.meta.url)),safety=inspectNativePrismaClient(apiRoot);
console.log(JSON.stringify({coverageMode,generatedEnvironmentChecked:safety.checkedCount,nativeEngine:safety.nativeEngine,envFilesRead:false}));
const started=performance.now(),db=await createDisposablePostgres({transport:"loopback-exec"});
let worker,primary;
try{
  assertNativePrismaUrl(db.prismaUrl);assert.match(db.runId,/^[a-f0-9-]{36}$/);
  assert.equal(await db.sql("SHOW listen_addresses"),"127.0.0.1");
  await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
  for(const fixture of ["legacy-prisma/checkout-payment.sql","widget-cross-sell-checkout/synthetic.sql","widget-cross-sell-checkout/payment.sql"])
    await db.sql(await readFile(new URL(`./fixtures/${fixture}`,import.meta.url),"utf8"));
  await installCheckoutSessionVersionTrigger(db);
  let ledger=await readFile(new URL("../prisma/migrations/20260910170000_payment_settlement_ledger/migration.sql",import.meta.url),"utf8");
  // The legacy fixture already owns this exact unique index. Keep every real
  // append-only trigger intact; only make that index declaration idempotent.
  assert.ok(ledger.includes('CREATE UNIQUE INDEX "payment_intents_id_merchant_id_key"'));
  ledger=ledger.replace('CREATE UNIQUE INDEX "payment_intents_id_merchant_id_key"','CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_id_merchant_id_key"');
  await db.sql(ledger);
  if(coverageMode==="product-types-only"){
    // This deployed migration is the canonical local source of the digital
    // tables (it is not duplicated under prisma/migrations). Preserve every
    // composite FK/index; the ledger above supplies payment_intents(id,M).
    const digital=await readFile(new URL("../prisma/deploy-migrations/20261003021500_digital_order_fulfillment/migration.sql",import.meta.url),"utf8");
    for(const declaration of ['CREATE TABLE "digital_entitlements"','CREATE TABLE "digital_deliveries"',
      'FOREIGN KEY ("order_id", "merchant_id")','FOREIGN KEY ("payment_intent_id", "merchant_id")',
      'FOREIGN KEY ("entitlement_id", "merchant_id")'])assert.ok(digital.includes(declaration),"exact_digital_fulfillment_migration_required");
    await db.sql(digital);
    assert.equal(await db.sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('digital_entitlements','digital_deliveries')"),"2");
    assert.equal(await db.sql(`SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f'
      AND conname IN ('digital_entitlements_order_id_merchant_id_fkey','digital_entitlements_payment_intent_id_merchant_id_fkey','digital_deliveries_entitlement_id_merchant_id_fkey')`),"3");
  }
  // Reuse the reviewed canonical source/coupon table declarations verbatim;
  // the widget's presence-only redemption stub is empty in this fresh owned DB.
  const sourceFixture=await readFile(new URL("./fixtures/storefront-coupon-admission/synthetic.sql",import.meta.url),"utf8");
  const sourceTable=sourceFixture.match(/CREATE TABLE storefront_carts \([\s\S]*?\n\);/);
  assert.ok(sourceTable,"exact_existing_source_table_required");await db.sql(sourceTable[0]);
  const couponFixture=await readFile(new URL("./fixtures/storefront-coupon-cross-sell/synthetic.sql",import.meta.url),"utf8");
  const couponTable=couponFixture.match(/CREATE TABLE coupons \([\s\S]*?\n\);/);
  assert.ok(couponTable,"exact_existing_coupon_table_required");await db.sql(couponTable[0]);
  // Identity cases read only these real original account columns. Keep the
  // table/index declarations verbatim, without claiming full migration history.
  const buyerMigration=await readFile(new URL("../prisma/migrations/20260512144458_merchant_shipping_profile/migration.sql",import.meta.url),"utf8");
  const buyerTable=buyerMigration.match(/CREATE TABLE "buyer_accounts" \([\s\S]*?\n\);/);
  const buyerEmailIndex=buyerMigration.match(/CREATE UNIQUE INDEX "buyer_accounts_email_key"[^;]+;/);
  assert.ok(buyerTable&&buyerEmailIndex,"exact_existing_buyer_identity_table_required");
  await db.sql(buyerTable[0]);await db.sql(buyerEmailIndex[0]);
  assert.equal(await db.sql("SELECT count(*) FROM coupon_redemptions"),"0");
  await db.sql(`ALTER TABLE coupon_redemptions
    ADD COLUMN coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    ADD COLUMN buyer_global_user_id TEXT,
    ADD COLUMN discount_applied DECIMAL(12,4) NOT NULL,
    ADD COLUMN source TEXT NOT NULL,
    ADD COLUMN order_id TEXT,
    ADD COLUMN created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN updated_at TIMESTAMP(3) NOT NULL,
    ADD UNIQUE(merchant_id,session_id,coupon_id);
    CREATE INDEX coupons_merchant_id_status_idx ON coupons(merchant_id,status);
    CREATE INDEX coupons_ends_at_idx ON coupons(ends_at);
    CREATE INDEX coupon_redemptions_merchant_coupon_status_idx ON coupon_redemptions(merchant_id,coupon_id,status);
    CREATE INDEX coupon_redemptions_merchant_buyer_coupon_status_idx ON coupon_redemptions(merchant_id,buyer_global_user_id,coupon_id,status);`);
  worker=spawn(process.execPath,["--max-old-space-size=256","--import",new URL("./test-network-guard.mjs",import.meta.url).href,
    "--loader",new URL("./ready-prod-loader.mjs",import.meta.url).href,fileURLToPath(new URL("./normal-checkout-payment.native-worker.mjs",import.meta.url)),db.prismaUrl,db.runId,coverageMode],
    {cwd:apiRoot,env:nativePrismaWorkerEnvironment(process.env),windowsHide:true,stdio:["ignore","inherit","inherit"]});
  let deadline;
  const result=await new Promise((resolve,reject)=>{
    // The default now also includes eight real detachment cases; its worker
    // remains heap256 and serial, with the same owned-resource cleanup fence.
    deadline=setTimeout(()=>reject(new Error("native_normal_payment_deadline_exceeded")),coverageMode==="baseline-and-identity"?180_000:120_000);
    worker.once("error",reject);worker.once("close",(code,signal)=>resolve({code,signal}));
  }).finally(()=>clearTimeout(deadline));
  assert.equal(result.code,0,"native_normal_payment_worker_failed");assert.equal(result.signal,null);
}catch(error){primary=error;}
finally{
  const cleanup=[];
  try{await terminateOwnedNativeWorker(worker);}catch(error){cleanup.push(error);}
  try{await db.dispose();assert.deepEqual(db.bridgeStatus(),{listening:false,sockets:0,children:0});}catch(error){cleanup.push(error);}
  console.log(JSON.stringify({phase:"normal-checkout-payment",coverageMode,status:primary||cleanup.length?"failed":"passed",cleanupErrors:cleanup.length,
    disposableDatabaseRemoved:cleanup.length===0,bridgeClosed:cleanup.length===0,durationMs:Math.round(performance.now()-started),network:"none",productionAccess:false}));
  if(primary||cleanup.length)throw new AggregateError([...(primary?[primary]:[]),...cleanup],"native_normal_payment_validation_failed");
}
