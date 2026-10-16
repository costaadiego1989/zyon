import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';

const api = 'https://api-sandbox-8146.up.railway.app';
const adminUrl = 'https://zyon-control-9a0o0kkd0-diegos-projects-b6fd2a25.vercel.app';
const website = 'https://zyon-agentic-checkout-i2ei0bwk9-diegos-projects-b6fd2a25.vercel.app';
const dashboard = 'https://dashboard-sandbox-59d9.up.railway.app';
const output = path.resolve('../../.audit/automatic-campaigns-release-20261016/evidence');
await mkdir(output, { recursive: true });
const railway = path.join(process.env.APPDATA, 'npm/node_modules/@railway/cli/bin/railway.exe');
const vercel = path.join(process.env.APPDATA, 'npm/node_modules/vercel/dist/index.js');
const run = (exe, args) => {
  const r = spawnSync(exe, args, { windowsHide: true, encoding: 'utf8', timeout: 55000, maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw Error(`qa_operation_failed:${args[0]}`);
  return r.stdout;
};
function remote(source, data = {}) {
  const guard = "if(process.env.RAILWAY_ENVIRONMENT_NAME!=='sandbox'||!process.env.STRIPE_SECRET_KEY.startsWith('sk_test_'))throw Error('sandbox_required');";
  const encoded = Buffer.from(guard + source).toString('base64');
  const payload = Buffer.from(JSON.stringify(data)).toString('base64');
  const result = run(railway, ['ssh', '-p', 'b8421237-6557-4677-a08c-c93453b08568', '-s', 'api', '-e', 'sandbox', '--', `node -e 'eval(Buffer.from(process.argv[1],process.argv[2]).toString())' ${encoded} base64 ${payload}`]);
  const line = result.split(/\r?\n/).find(line => line.startsWith('RESULT '));
  if (!line) throw Error('qa_result_missing');
  return JSON.parse(line.slice(7));
}
const config = JSON.parse(run(railway, ['variable', 'list', '-p', 'b8421237-6557-4677-a08c-c93453b08568', '-s', 'api', '-e', 'sandbox', '--json']));
assert.ok(config.STRIPE_SECRET_KEY.startsWith('sk_test_'));
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const Stripe = requireApi('stripe');
const stripe = new Stripe(config.STRIPE_SECRET_KEY, { timeout: 15000, maxNetworkRetries: 0 });
assert.equal((await stripe.accounts.retrieve()).id, 'acct_1TVJ9KPvEQVo3vcN');
const credential = JSON.parse(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$c=Import-Clixml -LiteralPath (Join-Path $env:LOCALAPPDATA 'Zyon\\homolog\\admin.credential.xml');[pscustomobject]@{email=$c.UserName;password=$c.GetNetworkCredential().Password}|ConvertTo-Json -Compress"]));
const oidc = name => {
  const token = run(process.execPath, [vercel, 'project', 'token', name, '--scope', 'diegos-projects-b6fd2a25']).match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
  assert.ok(token); return token;
};
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  const r = await fetch(api + '/v1/billing/promotions/automatic');
  if (r.status === 200) { ready = true; break; }
  if (attempt % 12 === 0) console.log(JSON.stringify({ waitingForMigratedSandbox: true, status: r.status }));
  await new Promise(resolve => setTimeout(resolve, 5000));
}
assert.ok(ready, 'migrated_sandbox_not_ready');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' });
for (const [url, name] of [[adminUrl, 'zyon-control'], [website, 'zyon-agentic-checkout']]) {
  const token = oidc(name);
  await context.route(url + '/**', route => route.continue({ headers: { ...route.request().headers(), 'x-vercel-trusted-oidc-idp-token': token } }));
}
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const checks = [], promotions = [], sessions = [];
const merchantId = 'qa-auto-campaign-' + randomUUID();
let adminToken, merchant, customerId;
async function admin(suffix = '', init = {}) {
  const r = await fetch(api + '/v1/platform/billing/promotions' + suffix, { ...init, headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' } });
  if (!r.ok) throw Error(`qa_admin_http_${r.status}`);
  return r.json();
}
async function feed() {
  const r = await fetch(api + '/v1/billing/promotions/automatic'); assert.equal(r.status, 200);
  const result = await r.json(); return (result.data ?? result).campaigns;
}
async function awaitFeed(code, visible) {
  for (let i = 0; i < 12; i++) {
    const rows = await feed(); if (rows.some(p => p.code === code) === visible) return rows;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error('campaign_feed_state_mismatch');
}
async function createInUi(specific) {
  const code = `QA-AUTO-${specific ? 'SPEC' : 'ALL'}-${Date.now().toString(36).toUpperCase()}`;
  await page.getByRole('button', { name: 'Criar cupom', exact: true }).click();
  await page.getByLabel(/^Código do cupom/).fill(code);
  await page.getByLabel('Nome da campanha (opcional)', { exact: true }).fill(specific ? 'QA Growth e Scale - 50% por 3 meses' : 'QA todos os planos - 50% por 3 meses');
  await page.getByLabel('Tipo de desconto').selectOption('percent');
  await page.getByLabel('Valor do desconto (%)', { exact: true }).fill('50');
  const local = time => new Date(time - 3 * 3600000).toISOString().slice(0, 16);
  await page.getByLabel('Data de início', { exact: true }).fill(local(Date.now() - 60000));
  await page.getByLabel('Data final', { exact: true }).fill(local(Date.now() + 86400000));
  if (specific) {
    await page.getByRole('radio', { name: 'Planos específicos', exact: true }).check();
    await page.getByRole('checkbox', { name: /Starter/ }).uncheck();
  } else await page.getByRole('radio', { name: /Todos os planos pagos/ }).check();
  await page.getByRole('checkbox', { name: /Divulgar e aplicar automaticamente/ }).check();
  await page.getByText('Opções da assinatura e limites', { exact: false }).click();
  await page.getByLabel(/^Duração do desconto/).selectOption('repeating');
  await page.getByLabel('Quantidade de meses', { exact: true }).fill('3');
  await page.screenshot({ path: path.join(output, `homolog-admin-${specific ? 'specific' : 'all'}-form.png`), fullPage: true });
  const response = page.waitForResponse(r => r.url().endsWith('/platform/billing/promotions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar cupom', exact: true }).click();
  const savedResponse = await response; assert.equal(savedResponse.status(), 201);
  const saved = await savedResponse.json(); promotions.push(saved);
  await page.getByRole('status').filter({ hasText: `Cupom ${code} criado.` }).waitFor();
  assert.equal(saved.autoApply, true); assert.equal(saved.durationMonths, 3); assert.equal(saved.livemode, false);
  assert.deepEqual([...saved.plans].sort(), specific ? ['growth', 'scale'] : ['growth', 'scale', 'starter179']);
  const provider = await stripe.promotionCodes.retrieve(saved.stripePromotionCodeId);
  const coupon = await stripe.coupons.retrieve(saved.stripeCouponId, { expand: ['applies_to'] });
  assert.equal(provider.active, true); assert.equal(coupon.percent_off, 50); assert.equal(coupon.applies_to.products.length, specific ? 2 : 3);
  const publicRow = (await awaitFeed(code, true)).find(p => p.code === code);
  assert.deepEqual(publicRow.plans, saved.plans); assert.equal(publicRow.stripePromotionCodeId, undefined); assert.equal(publicRow.createdBy, undefined); assert.equal(publicRow.id, undefined);
  checks.push(specific ? 'specific-plans-ui-persisted-stripe-restricted' : 'all-paid-plans-ui-persisted-stripe-restricted');
  return saved;
}
try {
  assert.equal((await fetch(api + '/ready')).status, 200);
  assert.equal((await fetch(api + '/v1/platform/billing/promotions')).status, 401);
  assert.equal((await fetch(api + '/v1/billing/checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  checks.push('anonymous-public-feed-and-protected-admin-checkout');
  await page.goto(adminUrl);
  await page.getByLabel('E-mail', { exact: true }).fill(credential.email);
  await page.getByLabel('Senha', { exact: true }).fill(credential.password);
  const loginResponse = page.waitForResponse(r => r.url().endsWith('/platform/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Entrar/ }).click();
  const logged = await loginResponse; assert.equal(logged.status(), 201); adminToken = (await logged.json()).access_token;
  await page.getByRole('button', { name: 'Cupons de assinatura', exact: true }).click();
  await page.getByRole('button', { name: 'Criar cupom', exact: true }).waitFor();
  const all = await createInUi(false);
  await admin('/' + all.id, { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
  await awaitFeed(all.code, false);
  await page.reload(); await page.getByRole('button', { name: 'Cupons de assinatura', exact: true }).click();
  const specific = await createInUi(true);
  merchant = remote(`(async()=>{const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();const d=JSON.parse(Buffer.from(process.argv[3],'base64'));try{const {PrismaAuthRepository}=await import('./dist/modules/auth/infrastructure/prisma-auth.repository.js');const {JwtService}=await import('./dist/modules/auth/domain/services/jwt.service.js');const repo=new PrismaAuthRepository(p);const made=await repo.createMerchantWithOwner({merchantId:d.id,merchantName:'QA automatic campaigns - no payment',email:d.id+'@example.test',passwordHash:'!qa-disabled-password-login'});await p.merchant.update({where:{id:d.id},data:{storeSettings:{registration_pending:true,plan_selection_pending:true}}});const principal={userId:made.user.id,merchantId:d.id,email:made.user.email,role:'owner'};const token=await new JwtService(process.env.JWT_SECRET,900,repo).issue(principal);console.log('RESULT '+JSON.stringify({token,userId:made.user.id}));}finally{await p.$disconnect()}})().catch(()=>{process.exitCode=1});`, { id: merchantId });
  const headers = { Authorization: 'Bearer ' + merchant.token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(api + '/v1/platform/billing/promotions', { headers })).status, 401);
  const checkout = async (plan, promotionCode, expectedCents) => {
    const r = await fetch(api + '/v1/billing/checkout-session', { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ plan, billingCycle: 'monthly', ...(promotionCode ? { promotionCode } : {}) }) });
    assert.equal(r.status, 201, 'actual_checkout_http_status'); const body = await r.json();
    sessions.push(body.sessionId); const session = await stripe.checkout.sessions.retrieve(body.sessionId);
    customerId = session.customer; assert.equal(session.livemode, false); assert.equal(session.amount_total, expectedCents);
    assert.notEqual(session.allow_promotion_codes, true); return session;
  };
  for (const [plan, cycle, code] of [['starter179', 'monthly', specific.code], ['growth', 'annual', specific.code], ['growth', 'monthly', 'INVALID-QA-CODE']]) {
    const r = await fetch(api + '/v1/billing/checkout-session', { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ plan, billingCycle: cycle, promotionCode: code }) });
    if (cycle === 'annual' && config.BILLING_ANNUAL_ENABLED !== 'true') {
      assert.equal(r.status, 503); assert.ok(JSON.stringify(await r.json()).includes('billing_annual_unavailable'));
    } else assert.equal(r.status, 400, 'invalid_or_ineligible_coupon_blocked');
  }
  checks.push('server-rejects-wrong-plan-annual-invalid-code');
  await checkout('starter179', null, 17900);
  await checkout('growth', specific.code, 22450);
  await checkout('scale', specific.code, 37450);
  checks.push('real-app-api-stripe-test-full-and-discounted-prices');
  await context.addCookies([{ name: 'aacp_access_token', value: merchant.token, domain: new URL(api).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'None' }]);
  const app = await context.newPage(); app.setDefaultTimeout(45000); app.on('pageerror', e => errors.push(e.message));
  await app.goto(dashboard + '/?plan=growth&cycle=monthly');
  await app.locator('[data-plan-key="growth"] .billing-promotion-terms').waitFor();
  await app.locator('.plan-selection__brand img').evaluate(image => image.decode());
  assert.equal(await app.locator('.plan-selection__brand a').evaluate(link => getComputedStyle(link).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await app.locator('[data-plan-key]').count(), 4);
  assert.equal(await app.locator('[data-plan-key="starter179"] .billing-promotion-terms').count(), 0);
  assert.ok((await app.locator('[data-plan-key="growth"]').innerText()).includes('224,50'));
  await app.getByRole('radio', { name: 'Selecionar Growth', exact: true }).check();
  assert.equal(await app.getByLabel('Cupom de assinatura', { exact: false }).isVisible(), false);
  await app.screenshot({ path: path.join(output, 'homolog-app-automatic-growth.png') });
  const created = app.waitForResponse(r => r.url().endsWith('/billing/checkout-session') && r.request().method() === 'POST');
  await app.getByRole('button', { name: /Confirmar Growth no Stripe/ }).click();
  const createdResponse = await created; assert.equal(createdResponse.status(), 201);
  const body = await createdResponse.json(); sessions.push(body.sessionId);
  assert.equal(createdResponse.request().postDataJSON().promotionCode, specific.code);
  const actual = await stripe.checkout.sessions.retrieve(body.sessionId); assert.equal(actual.amount_total, 22450);
  await app.waitForURL('https://checkout.stripe.com/**');
  await app.getByText(/224,50/).first().waitFor({ timeout: 45000 });
  await app.screenshot({ path: path.join(output, 'homolog-stripe-preapplied-growth.png') });
  checks.push('published-app-real-session-no-code-entry-actual-stripe-navigation');
  const web = await context.newPage(); web.on('pageerror', e => errors.push(e.message));
  await web.goto(website); await web.locator('.subscription-promo-top:not([hidden])').waitFor();
  assert.equal(await web.locator('[data-offer="starter179"] .subscription-plan-discount').isVisible(), false);
  assert.ok((await web.locator('[data-offer="growth"] .subscription-plan-discount').innerText()).includes('224,50'));
  assert.ok((await web.locator('[data-subscription-campaign-link]').first().getAttribute('href')).startsWith(dashboard));
  for (const width of [1440, 390]) {
    await web.setViewportSize({ width, height: 1000 });
    assert.ok(await web.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await web.screenshot({ path: path.join(output, `homolog-website-${width}.png`) });
  }
  checks.push('published-marketing-real-api-specific-scope-responsive');
  await admin('/' + specific.id, { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
  await awaitFeed(specific.code, false);
  const denied = await fetch(api + '/v1/billing/checkout-session', { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ plan: 'growth', billingCycle: 'monthly', promotionCode: specific.code }) });
  assert.equal(denied.status, 400); checks.push('disabled-campaign-absent-and-rejected-at-checkout');
  await admin('/' + all.id, { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
  await awaitFeed(all.code, true);
  await checkout('starter179', all.code, 8950);
  await app.goto(dashboard + '/?plan=starter179&cycle=monthly');
  await app.locator('[data-plan-key="starter179"] .billing-promotion-terms').waitFor();
  await app.getByRole('radio', { name: 'Selecionar Starter', exact: true }).check();
  await app.locator('.plan-selection__brand img').evaluate(image => image.decode());
  assert.ok((await app.locator('[data-plan-key="starter179"] .billing-plan-details__price').innerText()).includes('89,50'));
  await app.screenshot({ path: path.join(output, 'homolog-app-all-plans-starter-discount-logo.png') });
  await app.setViewportSize({ width: 390, height: 844 });
  assert.ok(await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await app.screenshot({ path: path.join(output, 'homolog-app-all-plans-mobile-logo.png') });
  checks.push('all-plan-campaign-reenabled-starter-8950');
  assert.deepEqual(errors, []);
  const result = { proof: 'deployed_ui_actual_api_database_and_stripe_TEST_unpaid_checkout', checks, adminUrl, dashboard, website, paymentExecuted: false, fixtureResponses: false, newCampaignsOnly: promotions.map(p => ({ id: p.id, code: p.code })), protectedUserTestCouponConsumed: false };
  await writeFile(path.join(output, 'homolog-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (e) {
  await page.screenshot({ path: path.join(output, 'homolog-failure.png'), fullPage: true }).catch(() => {});
  throw e;
} finally {
  const cleanup = [];
  for (const id of [...new Set(sessions)]) {
    const current = await stripe.checkout.sessions.retrieve(id).catch(() => null);
    if (current?.status === 'open') await stripe.checkout.sessions.expire(id);
  }
  for (const promotion of promotions) { await admin('/' + promotion.id, { method: 'DELETE' }); cleanup.push(promotion.code); }
  if (merchant) {
    const customers = await stripe.customers.list({ email: merchantId + '@example.test', limit: 10 });
    for (const customer of customers.data) {
      assert.equal((await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 1 })).data.length, 0);
      await stripe.customers.del(customer.id);
    }
    remote(`(async()=>{const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();const d=JSON.parse(Buffer.from(process.argv[3],'base64'));try{if(!d.id.startsWith('qa-auto-campaign-'))throw Error('scope');await p.merchant.delete({where:{id:d.id}});console.log('RESULT '+JSON.stringify({removed:true}));}finally{await p.$disconnect()}})().catch(()=>{process.exitCode=1});`, { id: merchantId });
  }
  if (adminToken) await fetch(api + '/v1/platform/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + adminToken } });
  await browser.close(); console.log(JSON.stringify({ qaCampaignsDeleted: cleanup, unpaidSessionsClosed: true, userCouponUnchanged: true }));
}
