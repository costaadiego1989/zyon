import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 20000 });

// Real QA UI writes. Only the seed-owned paused merchant may be changed; its
// original published rules and paused state must be restored through the UI.
const auth = JSON.parse(await fs.readFile(process.env.CASHBACK_BROWSER_AUTH_FILE, 'utf8'));
const origin = process.env.CASHBACK_BROWSER_ORIGIN;
const output = process.env.CASHBACK_BROWSER_REPORT_DIR;
assert.ok(output && ['local', 'homolog'].includes(auth.environment));
const local = auth.environment === 'local';
assert.equal(new URL(auth.baseUrl).hostname, local ? '127.0.0.1' : 'api-sandbox-8146.up.railway.app');
assert.equal(new URL(origin).hostname, local ? '127.0.0.1' : 'dashboard-sandbox-59d9.up.railway.app');
const merchantId = 'qa-cashback-v1-paused';
const token = auth.ownerTokens[merchantId];
assert.ok(token);
const api = auth.baseUrl.replace(/\/$/, '');
const read = async route => {
  const response = await fetch(api + route, { headers: { authorization: `Bearer ${token}` }, redirect: 'error' });
  assert.equal(response.status, 200);
  return response.json();
};
await fs.mkdir(output, { recursive: true });
const before = await read('/dashboard/cashback/program');
const beforeWallet = await read('/dashboard/cashback/customers/qa-cashback-v1-buyer-canonical');
assert.equal(before.status, 'paused');
const errors = [], writes = [], cases = [], responses = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    // Each fresh dashboard reload also exercises existing billing/navigation
    // endpoints. Separate viewport runs by their normal rate-limit window.
    if (cases.length) await new Promise(resolve => setTimeout(resolve, 60000));
    const context = await browser.newContext({ viewport, timezoneId: 'America/Sao_Paulo' });
    await context.addCookies([{ name: 'aacp_access_token', value: token, domain: new URL(api).hostname,
      path: '/', httpOnly: true, secure: !local, sameSite: local ? 'Lax' : 'None' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(String(error.message).slice(0, 300)));
    page.on('response', response => {
      const request = response.request(), url = new URL(response.url());
      if (url.origin === new URL(api).origin) responses.push({method:request.method(),path:url.pathname,status:response.status(),viewport:viewport.width});
      if (url.origin === new URL(api).origin && /\/dashboard\/cashback/.test(url.pathname) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        writes.push({ method: request.method(), path: url.pathname, status: response.status(), viewport: viewport.width });
      }
    });
    try {
      await page.goto(origin + '/#cashback');
      const status = page.getByRole('region', { name: 'Situação do programa' });
      await expect(status).toContainText('Novos ganhos pausados');
      await page.getByRole('button', { name: 'Configuração', exact: true }).click();
      const terms = page.getByLabel('Condições do cashback', { exact: true });
      await expect(terms).toHaveValue(before.published.terms);
      await terms.fill(before.published.terms + '\nValidação QA do rascunho.');
      await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();
      const saved = await read('/dashboard/cashback/program');
      assert.equal(saved.status, 'paused');
      assert.deepEqual(saved.published, before.published);
      assert.equal(saved.draft.terms, before.published.terms + '\nValidação QA do rascunho.');
      await terms.fill(before.published.terms);
      await page.getByRole('button', { name: 'Revisar e publicar', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Confira antes de ativar' })).toBeVisible();
      await page.getByRole('button', { name: 'Publicar e ativar', exact: true }).click();
      await expect(status).toContainText('Ativo');
      const published = await read('/dashboard/cashback/program');
      assert.equal(published.status, 'active');
      assert.deepEqual(published.published, before.published);
      assert.ok(published.version > before.version);
      await page.getByRole('button', { name: 'Pausar novos ganhos', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Pausar novos ganhos', exact: true }).click();
      await expect(status).toContainText('Novos ganhos pausados');
      await page.reload();
      await expect(status).toContainText('Novos ganhos pausados');
      assert.deepEqual((await read('/dashboard/cashback/customers/qa-cashback-v1-buyer-canonical')).balance, beforeWallet.balance);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(output, `controls-${viewport.width}.png`), fullPage: true });
      cases.push({ viewport, pass: true, checks: ['draft saved without activation', 'original rules reviewed and published', 'paused and reloaded', 'wallet unchanged'] });
    } catch (error) {
      cases.push({ viewport, pass: false, error: String(error.message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED]').slice(0, 1500) });
      await page.screenshot({ path: path.join(output, `controls-${viewport.width}-failed.png`), fullPage: true }).catch(() => {});
      break;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
const after = await read('/dashboard/cashback/program');
const restored = after.status === 'paused' && JSON.stringify(after.published) === JSON.stringify(before.published);
const report = { environment: auth.environment, merchantId, passed: cases.filter(c => c.pass).length,
  failed: cases.filter(c => !c.pass).length, cases, writes, responses, pageErrors: errors, restored,
  actualApi: true, businessMocks: false, externalPayments: 0, customerMessages: 0 };
await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, restored, writes: writes.length, errors: errors.length }));
process.exitCode = report.failed || !restored || errors.length || writes.some(w => w.status >= 400) || report.passed !== 2 ? 1 : 0;
