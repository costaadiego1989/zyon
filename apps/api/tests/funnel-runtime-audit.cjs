const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.resolve(process.env.FUNNEL_RUNTIME_ROOT || path.join(require('node:os').tmpdir(), 'zyon-funnel-release-20260914'));
const paymentMode = process.argv.includes('--payment');
if ([path.join(root, '.env'), path.join(root, 'apps/api/.env')].some(file => fs.existsSync(file))) {
  throw new Error('runtime_audit_requires_isolated_checkout_without_env_files');
}
const env = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  NODE_ENV: 'production', PORT: '5317', DATABASE_URL: 'postgresql://funnel_audit:funnel-local-only@127.0.0.1:55441/funnel_release',
  JWT_SECRET: randomBytes(32).toString('hex'), BUYER_JWT_SECRET: randomBytes(32).toString('hex'),
  EMBED_TOKEN_SECRET: randomBytes(32).toString('hex'), AACP_PAYMENT_ENC_KEY: randomBytes(32).toString('hex'),
  AACP_PII_ENC_KEY: randomBytes(32).toString('hex'), E2E_SEED_ENABLED: 'false',
  OPERATIONS_CURSOR_SECRET: randomBytes(32).toString('hex'), CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:5186',
  AGENT_SESSION_TOKEN_SECRET: randomBytes(32).toString('hex'), REDIS_URL: 'redis://127.0.0.1:56381',
  OPENROUTER_API_KEY: 'audit-fake-key', OPENROUTER_BASE_URL: 'http://127.0.0.1:5318',
});
if (paymentMode) Object.assign(env, { STRIPE_SECRET_KEY: 'sk_test_funnel_audit', STRIPE_WEBHOOK_SECRET: 'whsec_funnel_audit' });
const log = path.join(root, paymentMode ? 'payment-runtime.log' : 'startup-audit.log');
const fd = fs.openSync(log, 'w');
const child = spawn(process.execPath, ['dist/main.js'], { cwd: path.join(root, 'apps/api'), env, stdio: ['ignore', fd, fd], windowsHide: true });
let exitCode;
child.once('exit', code => { exitCode = code; });
(async () => {
  const checks = [];
  let db;
  async function request(route, options = {}, expected = 200) {
    const response = await fetch('http://127.0.0.1:5317' + route, options);
    const body = await response.json();
    assert.equal(response.status, expected, route + ': ' + JSON.stringify(body).slice(0, 350));
    return { response, body };
  }
  function post(body, token) {
    return { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) };
  }
  try {
    for (let i = 0; i < 360; i++) {
      if (exitCode !== undefined) throw new Error('startup_exited_' + exitCode);
      try {
        const response = await fetch('http://127.0.0.1:5317/ready', { signal: AbortSignal.timeout(1000) });
        if (response.ok) { checks.push({ route: '/ready', status: response.status, body: await response.json() }); break; }
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    if (!checks.length) throw new Error('startup_timeout');
    for (const route of ['/health', '/v1/checkout/funnel/mrc_audit', '/v1/storefront/funnel/mrc_audit']) {
      const response = await fetch('http://127.0.0.1:5317' + route);
      assert.equal(response.status, route === '/health' ? 200 : 401);
      checks.push({ route, status: response.status, body: await response.json() });
    }
    const email = `funnel-${Date.now()}@example.test`;
    const password = 'ZyonAudit@2026!';
    const registration = await request('/v1/auth/register', post({ merchant_name: 'Funnel audit', email, password }), 201);
    const merchant = registration.body.merchant_id;
    const login = await request('/v1/auth/login', post({ email, password }), 201);
    const token = login.body.access_token;
    assert.equal(login.body.merchant_id, merchant);
    assert.match(login.response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(login.response.headers.get('set-cookie'), /Secure/i);
    checks.push({ check: 'merchant registration and password login persist a session', passed: true });

    const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
    const { PrismaClient } = apiRequire('@prisma/client');
    db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
    const load = relative => import(pathToFileURL(path.join(root, 'apps/api/dist', relative)).href);
    const { EmbedTokenService } = await load('modules/embed/domain/embed-token.service.js');
    const { embedCheckoutSessionId } = await load('modules/embed/domain/embed-checkout-session.js');
    const { RealtimeCapabilityService } = await load('shared/auth/realtime-capability.js');
    const now = Math.floor(Date.now() / 1000);
    const claims = { typ: 'aacp_embed_v1', merchantId: merchant, nonce: 'funnel-runtime', issuedAtUnix: now, expiresAtUnix: now + 600, scopes: ['checkout:track'] };
    const embedToken = new EmbedTokenService({ value: Buffer.from(env.EMBED_TOKEN_SECRET) }).sign(claims);
    const paidSession = embedCheckoutSessionId(claims);
    const sessions = [paidSession, 'chk_open', 'conv_signup', 'conv_login'];
    for (const sessionId of sessions) {
      await db.checkoutSession.create({ data: { merchantId: merchant, sessionId, globalUserId: merchant + sessionId,
        conversationId: sessionId, cart: { items: [], total: 0, currency: 'BRL' }, createdAt: new Date(), updatedAt: new Date() } });
    }
    for (const [sessionId, eventName] of [[paidSession, 'checkout_started'], [paidSession, 'order_completed'], [paidSession, 'order_completed'],
      ['chk_open', 'checkout_started'], ['conv_signup', 'auth_registration_completed'], ['conv_login', 'login_completed']]) {
      await db.checkoutEvent.create({ data: { merchantId: merchant, sessionId, eventName, occurredAt: new Date() } });
    }
    const authorization = { headers: { Authorization: 'Bearer ' + token } };
    for (const source of ['checkout', 'storefront']) {
      const funnel = await request(`/v1/${source}/funnel/${merchant}?period=7d&breakdown=device`, authorization);
      assert.equal(funnel.body.totalSessions, 2);
      assert.equal(funnel.body.overallConversion, 50);
      await request(`/v1/${source}/funnel/another_merchant`, authorization, 403);
      await request(`/v1/${source}/funnel/${merchant}?from=2026-09-01`, authorization, 400);
      checks.push({ check: source + ' authenticated funnel, tenant isolation and date validation', passed: true });
    }
    const before = await db.checkoutEvent.count({ where: { merchantId: merchant, eventName: 'order_completed' } });
    const rejected = await request('/v1/embed/track', post({ session_id: paidSession, event: 'order_completed' }, embedToken), 400);
    assert.equal(rejected.body.code, 'checkout_event_server_only');
    assert.equal(await db.checkoutEvent.count({ where: { merchantId: merchant, eventName: 'order_completed' } }), before);
    const conversationToken = new RealtimeCapabilityService(env.JWT_SECRET).issue({ purpose: 'storefront-conversation', merchantId: merchant, resourceId: 'conv_signup' }).token;
    const blocked = await request('/v1/storefront/conversations/conv_signup/events', post({ merchant_id: merchant, event: 'purchase_completed' }, conversationToken), 400);
    assert.equal(blocked.body.code, 'storefront_event_server_only');
    checks.push({ check: 'public checkout and storefront cannot forge conversion over real HTTP', passed: true });
    if (!paymentMode) {
      await request('/v1/webhooks/stripe', post({}), 503);
      checks.push({ check: 'optional Stripe does not prevent startup and unconfigured callback is rejected', passed: true });
    } else {
      const Stripe = apiRequire('stripe');
      const stripe = new Stripe(env.STRIPE_SECRET_KEY);
      const { paymentCartFingerprint } = await load('modules/checkout/domain/services/payment-cart-fingerprint.js');
      const cart = { currency: 'BRL', total: 100, currentDiscount: 0, items: [{ sku: 'audit-item', name: 'Audit item', quantity: 1, price: 100 }] };
      const shipping = { customerPrice: 0, realCost: 0, method: 'Audit pickup' };
      const breakdown = { version: 1, currency: 'BRL', itemsSubtotalCents: 10000, discountCents: 0, shippingCents: 0, platformFeeCents: 99, totalCents: 10099,
        cartFingerprint: paymentCartFingerprint({ cart, shipping }) };
      async function prepareIntent(sessionId) {
        await db.checkoutSession.upsert({ where: { merchantId_sessionId: { merchantId: merchant, sessionId } },
          update: { cart, shipping }, create: { merchantId: merchant, sessionId, globalUserId: merchant + sessionId,
            conversationId: sessionId, cart, shipping, createdAt: new Date(), updatedAt: new Date() } });
        const id = 'pay_' + randomBytes(10).toString('hex');
        const providerPaymentId = 'pi_' + randomBytes(10).toString('hex');
        await db.paymentIntent.create({ data: { id, merchantId: merchant, sessionId, idempotencyKey: id, amountCents: 10099,
          currency: 'BRL', method: 'card', status: 'requires_action', providerPaymentId, amountBreakdown: breakdown } });
        return { id, providerPaymentId, sessionId };
      }
      function eventFor(intent, overrides = {}, type = 'payment_intent.succeeded') {
        return { id: 'evt_' + randomBytes(10).toString('hex'), type, data: { object: { id: intent.providerPaymentId,
          amount_received: 10099, currency: 'brl', metadata: { merchant_id: merchant, intent_id: intent.id }, ...overrides } } };
      }
      async function callback(event, status = 200, tamper = false) {
        const body = JSON.stringify(event);
        const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: env.STRIPE_WEBHOOK_SECRET });
        return request('/v1/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signature }, body: tamper ? body + ' ' : body }, status);
      }
      const approved = await prepareIntent('chk_open');
      const approvedEvent = eventFor(approved);
      await callback(approvedEvent, 401, true);
      assert.equal((await db.paymentIntent.findUnique({ where: { id: approved.id } })).status, 'requires_action');
      await callback(approvedEvent);
      assert.equal((await db.paymentIntent.findUnique({ where: { id: approved.id } })).status, 'approved');
      assert.equal(await db.completedOrder.count({ where: { merchantId: merchant, sessionId: approved.sessionId } }), 1);
      assert.equal((await request(`/v1/checkout/funnel/${merchant}?period=7d`, authorization)).body.overallConversion, 100);
      assert.equal((await callback(approvedEvent)).body.outcome, 'duplicate');
      await callback(eventFor(approved));
      assert.equal(await db.completedOrder.count({ where: { merchantId: merchant, sessionId: approved.sessionId } }), 1);
      assert.equal(await db.checkoutEvent.count({ where: { merchantId: merchant, sessionId: approved.sessionId, eventName: 'order_completed' } }), 1);
      checks.push({ check: 'signed callback persists approved payment, one order and one conversion; forged signature and duplicate callbacks handled', passed: true });
      for (const [sessionId, change, type] of [
        ['chk_declined', {}, 'payment_intent.payment_failed'],
        ['chk_wrong_amount', { amount_received: 1 }, 'payment_intent.succeeded'],
      ]) {
        const declined = await prepareIntent(sessionId);
        await callback(eventFor(declined, change, type));
        assert.equal((await db.paymentIntent.findUnique({ where: { id: declined.id } })).status, 'failed');
        assert.equal(await db.completedOrder.count({ where: { merchantId: merchant, sessionId } }), 0);
        assert.equal(await db.checkoutEvent.count({ where: { merchantId: merchant, sessionId, eventName: 'order_completed' } }), 0);
      }
      checks.push({ check: 'declined payment and wrong amount never create an order or conversion', passed: true });
      const wrongCurrency = await prepareIntent('chk_wrong_currency');
      await callback(eventFor(wrongCurrency, { currency: 'usd' }), 400);
      assert.equal((await db.paymentIntent.findUnique({ where: { id: wrongCurrency.id } })).status, 'requires_action');
      assert.equal(await db.completedOrder.count({ where: { merchantId: merchant, sessionId: wrongCurrency.sessionId } }), 0);
      checks.push({ check: 'wrong callback currency is rejected before payment mutation', passed: true });
    }

    const result = { checks, environment: 'real Nest production composition, disposable PostgreSQL and Redis; CAPTCHA and external providers not exercised; funnel events seeded' };
    fs.writeFileSync(path.join(root, paymentMode ? 'payment-runtime.json' : 'startup-audit.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ error: error.message, log }));
    process.exitCode = 1;
  } finally {
    child.kill();
    if (db) await db.$disconnect();
    fs.closeSync(fd);
  }
})();
