import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 25000 });

// Actual HTTP/browser checks using existing isolated QA identities. No route mocks,
// checkout creation, real OTP, provider messages, or payment operations.
const auth = JSON.parse(await fs.readFile(process.env.CASHBACK_BROWSER_AUTH_FILE, 'utf8'));
const mode = process.env.CASHBACK_UI_MODE;
const origin = process.env.CASHBACK_BROWSER_ORIGIN;
const out = process.env.CASHBACK_BROWSER_REPORT_DIR;
assert.ok(['local', 'homolog'].includes(auth.environment));
assert.ok(['dashboard', 'storefront'].includes(mode) && out);
const host = new URL(origin).hostname;
assert.equal(host, auth.environment === 'local' ? '127.0.0.1' : mode === 'dashboard'
  ? 'dashboard-sandbox-59d9.up.railway.app' : 'storefront-sandbox-3f42.up.railway.app');
await fs.mkdir(out, { recursive: true });
const results = [], requests = [], pageErrors = [], styles = [];
const browser = await chromium.launch({ headless: true });
const safeError = e => String(e.message ?? e).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED]').slice(0, 1600);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function shot(page, name) { await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true, animations: 'disabled' }); }
async function noOverflow(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal_overflow'); }
async function run(name, fn) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, error: safeError(e) }); }
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(report(), null, 2) + '\n');
}
function report() { return { environment: auth.environment, mode, passed: results.filter(r => r.pass).length,
  failed: results.filter(r => !r.pass).length, results, requests, styles, pageErrors, businessMocks: false,
  moneyWrites: 0, payments: 0, messages: 0 }; }
function observe(page, name) {
  page.setDefaultTimeout(25000);
  page.on('pageerror', e => pageErrors.push({ name, message: safeError(e) }));
  page.on('request', r => {
    const u = new URL(r.url());
    if (/\/dashboard\/cashback|\/buyer\/me\/cashback|\/storefront\/[^/]+\/config|\/conversation/.test(u.pathname)) {
      requests.push({ name, path: u.pathname, query: u.search, method: r.method() });
    }
  });
}
async function dashboard(viewport) {
  const merchant = 'qa-cashback-v1-specific';
  const context = await browser.newContext({ viewport, timezoneId: 'America/Sao_Paulo', acceptDownloads: true });
  await context.addCookies([{ name: 'aacp_access_token', value: auth.ownerTokens[merchant], domain: host,
    path: '/', httpOnly: true, secure: auth.environment === 'homolog', sameSite: 'Lax' }]);
  const page = await context.newPage(); observe(page, 'dashboard-' + viewport.width);
  try {
    await page.goto(origin + '/#cashback', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await expect(page.getByRole('heading', { name: 'Cashback', exact: true })).toBeVisible();
    await expect(page.locator('.cashback-current')).toContainText('R$ 37,00');
    const heading = () => page.locator('.page-header h1').evaluate(x => {
      const s = getComputedStyle(x); return { font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, line: s.lineHeight, spacing: s.letterSpacing };
    });
    const cashbackHeading = await heading();
    const programStyle = await page.locator('.cashback-program-state').evaluate(x => {
      const s = getComputedStyle(x); return { top: s.borderTopWidth, bottom: s.borderBottomWidth, margin: s.marginBlock };
    });
    assert.equal(programStyle.top, '0px'); assert.equal(programStyle.bottom, '0px');
    styles.push({ viewport, page: 'cashback', heading: cashbackHeading, programStyle });
    await noOverflow(page); await shot(page, 'cashback-' + viewport.width);
    await run(viewport.width + '-shared-components', async () => {
      await expect(page.getByRole('group', { name: 'Filtrar por período' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Este mês', exact: true })).toHaveAttribute('aria-pressed', 'true');
      for (const [label, days] of [['Hoje', 1], ['Últimos 7 dias', 7], ['Últimos 15 dias', 15], ['Últimos 30 dias', 30]]) {
        const response = page.waitForResponse(r => /\/dashboard\/cashback\/metrics\?/.test(r.url()) && r.request().method() === 'GET');
        await page.getByRole('button', { name: label, exact: true }).click();
        const r = await response; assert.equal(r.status(), 200);
        const from = await page.getByLabel('Data inicial', { exact: true }).inputValue();
        const to = await page.getByLabel('Data final', { exact: true }).inputValue();
        assert.equal((Date.parse(to) - Date.parse(from)) / 86400000 + 1, days);
        const u = new URL(r.url()); assert.equal(u.searchParams.get('from'), from + 'T00:00:00-03:00');
        assert.equal(u.searchParams.get('to'), to + 'T23:59:59.999-03:00');
      }
      await page.getByRole('button', { name: 'Este mês', exact: true }).click();
    });
    await run(viewport.width + '-transactions-custom-csv', async () => {
      await page.getByRole('group', { name: 'Seções de cashback' }).getByRole('button', { name: 'Extrato', exact: true }).click();
      await expect(page.locator('.cashback-table tbody tr').first()).toBeVisible();
      const next = page.getByRole('button', { name: 'Próxima página', exact: true });
      if (await next.isEnabled().catch(() => false)) {
        await next.click();
        await expect.poll(() => requests.filter(r => /\/dashboard\/cashback\/transactions$/.test(r.path)).at(-1)?.query).toContain('page=2');
      }
      await page.getByRole('button', { name: 'Hoje', exact: true }).click();
      await expect.poll(() => requests.filter(r => /\/dashboard\/cashback\/transactions$/.test(r.path)).at(-1)?.query).toContain('page=1');
      await page.getByLabel('Data inicial', { exact: true }).fill('2026-11-01');
      await page.getByLabel('Data final', { exact: true }).fill('2026-11-30');
      await expect(page.locator('.cashback-table tbody tr').first()).toBeVisible();
      await page.getByLabel('Tipo de movimentação', { exact: true }).selectOption('grant');
      await expect(page.locator('.cashback-table tbody tr')).toHaveCount(4);
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Exportar extrato', exact: true }).click();
      const d = await download; await d.saveAs(path.join(out, 'statement-' + viewport.width + '.csv'));
      const last = requests.filter(r => /\/dashboard\/cashback\/exports$/.test(r.path)).at(-1);
      assert.ok(last); const query = new URLSearchParams(last.query);
      assert.equal(query.get('from'), '2026-11-01T00:00:00-03:00');
      assert.equal(query.get('to'), '2026-11-30T23:59:59.999-03:00'); assert.equal(query.get('type'), 'grant');
      const csv = await fs.readFile(path.join(out, 'statement-' + viewport.width + '.csv'), 'utf8');
      assert.ok(csv.includes('qa-cashback-v1-buyer-canonical')); await noOverflow(page); await shot(page, 'statement-' + viewport.width);
    });
    await run(viewport.width + '-settings-customers', async () => {
      const sections = page.getByRole('group', { name: 'Seções de cashback' });
      await sections.getByRole('button', { name: 'Configuração', exact: true }).click();
      await expect(page.getByLabel('Percentual de cashback (%)', { exact: true })).toHaveValue('5,00');
      await noOverflow(page); await shot(page, 'settings-' + viewport.width);
      await sections.getByRole('button', { name: 'Clientes', exact: true }).click();
      await expect(page.getByRole('button', { name: 'QA Cashback Canal Unico', exact: true })).toBeVisible();
      await page.getByRole('searchbox', { name: 'Buscar cliente por nome ou e-mail' }).fill('Outro Cliente');
      await expect(page.locator('.cashback-table tbody tr')).toHaveCount(1);
      await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
      await expect(page.locator('.cashback-table tbody tr')).toHaveCount(2);
      await page.getByRole('button', { name: 'QA Cashback Canal Unico', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Extrato do cliente' })).toBeVisible();
      await expect(page.locator('.cashback-customer-detail .cashback-current')).toContainText('R$ 35,00');
      await noOverflow(page); await shot(page, 'customer-' + viewport.width);
    });
    await run(viewport.width + '-peer-heading-comparison', async () => {
      for (const [hash, name] of [['coupons', 'Cupons'], ['shipments', 'Pedidos e envios'], ['overview', 'Visão Geral']]) {
        await page.goto(origin + '/#' + hash, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
        const current = await heading(); assert.deepEqual(current, cashbackHeading);
        if (viewport.width > 700) await expect(page.locator('.console-desktop-heading .ui-breadcrumb__current')).toHaveText(name);
        styles.push({ viewport, page: hash, heading: current });
        await noOverflow(page); await shot(page, hash + '-' + viewport.width);
      }
    });
  } finally { await context.close(); }
}
async function storefront(viewport, key) {
  const merchantId = 'qa-cashback-v1-' + key, buyerId = 'qa-cashback-v1-buyer-canonical';
  const enabled = key === 'specific';
  const context = await browser.newContext({ viewport, timezoneId: 'America/Sao_Paulo' });
  await context.addInitScript(({ token, buyerId }) => {
    const email = buyerId + '@cashback.invalid', expires_at = Date.now() + 3600000;
    localStorage.setItem('zyon_buyer_token', token);
    const session = JSON.stringify({ global_user_id: buyerId, email, access_token: token, expires_at });
    localStorage.setItem('zyon_buyer_session', session); localStorage.setItem('aacp_buyer_auth_session', session);
  }, { token: auth.buyerTokens[merchantId], buyerId });
  const page = await context.newPage(); observe(page, 'storefront-' + key + '-' + viewport.width);
  try {
    await page.goto(origin + '/store/' + merchantId, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const refuse = page.getByRole('button', { name: 'Não aceito', exact: true });
    if (await refuse.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) await refuse.click();
    const menu = page.getByRole('button', { name: 'Consultar cashback', exact: true });
    if (enabled) {
      await expect(menu).toBeEnabled(); await shot(page, 'store-intro-' + viewport.width);
      await menu.click();
    } else {
      await expect(menu).toHaveCount(0);
      const chat = page.getByRole('button', { name: /^Por chat/ });
      if (await chat.isVisible({ timeout: 3000 }).catch(() => false)) await chat.click();
      await page.getByRole('button', { name: /^Abrir conta/ }).click();
    }
    const dialog = page.getByRole('dialog', { name: 'Hub do comprador' }); await expect(dialog).toBeVisible();
    const tab = dialog.getByRole('tab', { name: 'Cashback', exact: true });
    if (enabled) {
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const wallet = dialog.getByRole('region', { name: 'Seu cashback nesta loja' });
      await expect(wallet).toContainText('R$ 35,00'); await expect(wallet).toContainText('R$ 15,00');
      await expect(wallet.getByRole('heading', { name: 'Extrato', exact: true })).toBeVisible();
      await wallet.getByRole('button', { name: 'Atualizar saldo', exact: true }).click();
      await expect(wallet.getByRole('button', { name: 'Atualizar saldo', exact: true })).toBeEnabled();
      assert.ok(!requests.some(r => r.name === 'storefront-' + key + '-' + viewport.width && /conversation/.test(r.path) && r.method === 'POST'), 'cashback_navigation_started_conversation');
    } else {
      await expect(tab).toHaveCount(0);
      await dialog.getByRole('tab', { name: 'Fidelidade', exact: true }).click();
      const wallet = dialog.getByRole('region', { name: 'Seu cashback nesta loja' });
      if (key === 'paused') await expect(wallet).toContainText('R$ 30,00');
      else await expect(wallet).toHaveCount(0);
    }
    await noOverflow(page); await shot(page, 'store-' + key + '-' + viewport.width);
  } finally { await context.close(); }
}
try {
  for (const viewport of [{ width: 1630, height: 780 }, { width: 390, height: 844 }]) {
    if (mode === 'dashboard') await run(viewport.width + '-dashboard', () => dashboard(viewport));
    else for (const key of ['specific', 'paused', 'disabled', 'draft']) {
      await run(viewport.width + '-storefront-' + key, () => storefront(viewport, key)); await pause(5000);
    }
    if (mode === 'dashboard') await pause(60000);
  }
} finally { await browser.close(); await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(report(), null, 2) + '\n'); }
const final = report(); console.log(JSON.stringify({ environment: final.environment, mode, passed: final.passed, failed: final.failed, pageErrors: pageErrors.length }));
if (final.failed || pageErrors.length || requests.some(r => /\/dashboard\/cashback/.test(r.path) && !['GET','HEAD','OPTIONS'].includes(r.method))) process.exitCode = 1;
