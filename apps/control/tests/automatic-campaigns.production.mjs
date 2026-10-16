import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

if (process.argv[2] !== '--enable-blackfriday') throw Error('explicit_activation_flag_required');
const deployment = process.argv[3];
if (!/^[a-f0-9-]{36}$/.test(deployment ?? '')) throw Error('expected_production_deployment_required');
const api = 'https://api.zyon-payments.com.br', control = 'https://control.zyon-payments.com.br', app = 'https://app.zyon-payments.com.br', web = 'https://www.zyon-payments.com.br';
const project = 'b8421237-6557-4677-a08c-c93453b08568';
const output = path.resolve('../../.audit/automatic-campaigns-release-20261016/evidence');
await mkdir(output, { recursive: true });
const railway = path.join(process.env.APPDATA, 'npm/node_modules/@railway/cli/bin/railway.exe');
function command(args) {
  const r = spawnSync(railway, args, { windowsHide: true, encoding: 'utf8', timeout: 55000, maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw Error(`production_operation_failed:${args[0]}`); return r.stdout;
}
function remote(source) {
  const guard = `if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production'||process.env.RAILWAY_DEPLOYMENT_ID!=='${deployment}'||process.env.RAILWAY_PROJECT_ID!=='${project}')throw Error('production_identity_changed');`;
  const encoded = Buffer.from(guard + source).toString('base64');
  const text = command(['ssh', '-p', project, '-s', 'api', '-e', 'production', '--', `node -e 'eval(Buffer.from(process.argv[1],process.argv[2]).toString())' ${encoded} base64`]);
  const line = text.split(/\r?\n/).find(x => x.startsWith('RESULT ')); if (!line) throw Error('production_result_missing'); return JSON.parse(line.slice(7));
}
const config = JSON.parse(command(['variable', 'list', '-p', project, '-s', 'api', '-e', 'production', '--json']));
assert.ok(config.STRIPE_SECRET_KEY.startsWith('sk_live_'));
const requireApi = createRequire(new URL('../../api/package.json', import.meta.url));
const Stripe = requireApi('stripe');
const stripe = new Stripe(config.STRIPE_SECRET_KEY, { timeout: 15000, maxNetworkRetries: 0 });
assert.equal((await stripe.accounts.retrieve()).id, 'acct_1TWHY8CGsYQE7HwX');
const session = remote(`(async()=>{const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();try{const operators=await p.platformOperator.findMany({where:{role:'platform_admin',disabledAt:null},take:2});if(operators.length!==1)throw Error('ambiguous_admin');const a=operators[0];const {PrismaPlatformOperatorRepository}=await import('./dist/modules/platform-control/infrastructure/prisma-platform-operator.repository.js');const {PlatformJwtService}=await import('./dist/modules/platform-control/domain/services/platform-jwt.service.js');const token=await new PlatformJwtService(new PrismaPlatformOperatorRepository(p),process.env.PLATFORM_CONTROL_JWT_SECRET,900).issue({operatorId:a.id,email:a.email,role:a.role},a.authVersion);console.log('RESULT '+JSON.stringify({token,operator:{operator_id:a.id,email:a.email,role:a.role}}));}finally{await p.$disconnect()}})().catch(()=>{process.exitCode=1});`);
const headers = { Authorization: 'Bearer ' + session.token };
const browser = await chromium.launch({ headless: true });
let customer; const checkouts = [], checks = [];
try {
  assert.equal((await fetch(api + '/ready')).status, 200);
  assert.equal((await fetch(api + '/v1/platform/billing/promotions')).status, 401);
  const read = async () => {
    const r = await fetch(api + '/v1/platform/billing/promotions?search=BLACKFRIDAY', { headers }); assert.equal(r.status, 200);
    return (await r.json()).items.find(p => p.code === 'BLACKFRIDAY');
  };
  const before = await read(); assert.ok(before); assert.equal(before.discountValue, 5000); assert.equal(before.durationMonths, 3);
  assert.equal(before.expiresAt, '2026-12-01T03:00:00.000Z');
  assert.deepEqual([...before.plans].sort(), ['growth', 'scale', 'starter179']);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await context.addInitScript(({ origin, session }) => { if (location.origin === origin) sessionStorage.setItem('zyon.platform-control.session.v1', JSON.stringify(session)); }, { origin: control, session });
  const page = await context.newPage(); page.setDefaultTimeout(40000);
  await page.goto(control); await page.getByRole('button', { name: 'Cupons de assinatura', exact: true }).click();
  await page.getByLabel('Buscar cupom').fill('BLACKFRIDAY');
  const listed = page.waitForResponse(r => r.url().includes('/platform/billing/promotions?') && new URL(r.url()).searchParams.get('search') === 'BLACKFRIDAY');
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click(); assert.equal((await listed).status(), 200);
  await page.locator('.billing-skeleton').waitFor({ state: 'hidden' });
  const row = page.locator('.promotion-row').filter({ hasText: 'BLACKFRIDAY' });
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: /Todos os planos pagos/ }).isChecked(), true);
  const automatic = page.getByRole('checkbox', { name: /Divulgar e aplicar automaticamente/ });
  if (!before.autoApply) {
    assert.equal(before.timesRedeemed, 0, 'do_not_recreate_redeemed_discount');
    await automatic.check();
    const updated = page.waitForResponse(r => r.url().endsWith('/platform/billing/promotions/' + before.id) && r.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    assert.equal((await updated).status(), 200);
  }
  const after = await read();
  for (const key of ['code', 'name', 'discountType', 'discountValue', 'duration', 'durationMonths', 'expiresAt', 'maxRedemptions', 'firstTimeOnly']) assert.equal(after[key], before[key], 'campaign_contract_unchanged_' + key);
  assert.deepEqual(after.plans, before.plans); assert.equal(after.autoApply, true); assert.equal(after.enabled, true); assert.equal(after.livemode, true);
  const promotion = await stripe.promotionCodes.retrieve(after.stripePromotionCodeId);
  const coupon = await stripe.coupons.retrieve(after.stripeCouponId, { expand: ['applies_to'] });
  assert.equal(promotion.active, true); assert.equal(coupon.percent_off, 50); assert.equal(coupon.duration_in_months, 3); assert.equal(coupon.applies_to.products.length, 3);
  checks.push('real-production-admin-automatic-optin-all-plans-financial-terms-preserved');
  const publicResponse = await fetch(api + '/v1/billing/promotions/automatic', { headers: { Origin: web } });
  assert.equal(publicResponse.status, 200); assert.equal(publicResponse.headers.get('access-control-allow-origin'), web);
  const data = await publicResponse.json(); const campaigns = (data.data ?? data).campaigns;
  const blackFriday = campaigns.find(c => c.code === 'BLACKFRIDAY'); assert.ok(blackFriday); assert.equal(blackFriday.id, undefined); assert.equal(blackFriday.stripePromotionCodeId, undefined);
  checks.push('anonymous-live-feed-cors-and-private-field-projection');
  customer = await stripe.customers.create({ name: 'QA automatic promotion - unpaid validation only', metadata: { zyon_scope: 'automatic-campaigns-unpaid-20261016' } });
  for (const [plan, price, cents] of [['starter179', config.STRIPE_BILLING_PRICE_STARTER_179, 8950], ['growth', config.STRIPE_BILLING_PRICE_GROWTH, 22450], ['scale', config.STRIPE_BILLING_PRICE_SCALE, 37450]]) {
    const checkout = await stripe.checkout.sessions.create({ customer: customer.id, mode: 'subscription', line_items: [{ price, quantity: 1 }], discounts: [{ promotion_code: promotion.id }], success_url: app, cancel_url: app, metadata: { zyon_scope: 'automatic-campaigns-unpaid-20261016' } });
    checkouts.push(checkout.id); assert.equal(checkout.amount_total, cents); assert.equal(checkout.livemode, true);
    checks.push(`stripe-live-unpaid-${plan}-${cents}`);
  }
  await page.goto(control); await page.getByRole('button', { name: 'Cupons de assinatura', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'production-admin-campaign.png') });
  for (const [name, origin, projectName] of [['control', control, 'control'], ['dashboard', app, 'dashboard'], ['web', web, 'web']]) {
    const response = await fetch(origin); assert.equal(response.status, 200); const html = await response.text();
    const artifactEnvironment = name === 'dashboard' ? (process.env.BILLING_DASHBOARD_ARTIFACT_ENV ?? 'production') : name === 'web' ? (process.env.BILLING_WEB_ARTIFACT_ENV ?? 'production') : 'production';
    const expected = await readFile(path.resolve('../../.audit/automatic-campaigns-release-20261016', artifactEnvironment, projectName, '.vercel/output/static/index.html'), 'utf8');
    assert.equal(html, expected, 'published_exact_artifact_' + name);
    if (name !== 'web') {
      const bundle = html.match(/src="([^"]+\.js)"/)?.[1]; assert.ok(bundle);
      const js = await (await fetch(origin + bundle)).text(); assert.ok(js.includes(api)); assert.ok(!js.includes('https://api-sandbox-8146.up.railway.app'));
    }
    const surface = await context.newPage(); const errors = []; surface.on('pageerror', e => errors.push(e.message));
    await surface.goto(origin);
    if (name === 'web') {
      await surface.locator('.subscription-promo-top:not([hidden])').waitFor();
      for (const [plan, text] of [['starter179', '89,50'], ['growth', '224,50'], ['scale', '374,50']]) assert.ok((await surface.locator(`[data-offer="${plan}"] .subscription-plan-discount`).innerText()).includes(text));
    } else if (name === 'dashboard') await surface.getByText('Comece no Free por 7 dias.', { exact: true }).waitFor();
    for (const width of [1440, 390]) {
      await surface.setViewportSize({ width, height: 1100 });
      assert.ok(await surface.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const broken = await surface.locator('img').evaluateAll(images => images.filter(i => i.getBoundingClientRect().width > 0 && i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src'))); assert.deepEqual(broken, []);
      await surface.screenshot({ path: path.join(output, `production-${name}-${width}.png`) });
    }
    assert.deepEqual(errors, []); checks.push('published-exact-artifact-and-browser-' + name); await surface.close();
  }
  const result = { proof: 'production_admin_database_stripe_live_unpaid_sessions_and_published_assets', deployment, checks, coupon: { code: after.code, autoApply: after.autoApply, plans: after.plans, percent: 50, months: 3, expiresAt: after.expiresAt }, paymentExecuted: false, actualMerchantCheckoutInProductionTested: false };
  await writeFile(path.join(output, 'production-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  for (const id of checkouts) { const state = await stripe.checkout.sessions.retrieve(id); if (state.status === 'open') await stripe.checkout.sessions.expire(id); }
  if (customer) { assert.equal((await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 1 })).data.length, 0); await stripe.customers.del(customer.id); }
  await fetch(api + '/v1/platform/auth/logout', { method: 'POST', headers });
  await browser.close(); console.log(JSON.stringify({ unpaidLiveSessionsExpired: checkouts.length, temporaryCustomerRemoved: !!customer, adminSessionRevoked: true, noPaymentExecuted: true }));
}
