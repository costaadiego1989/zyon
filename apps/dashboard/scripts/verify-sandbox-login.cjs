const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const api = 'https://api-sandbox-8146.up.railway.app/v1';
const dashboard = 'https://dashboard-sandbox-59d9.up.railway.app';

async function run() {
  const email = `login-e2e-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const registration = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ merchant_name: `Sandbox Login ${Date.now()}`, email, password }) });
  if (registration.status !== 201) throw new Error(`Registration returned ${registration.status}`);
  const auth = await registration.json();
  const settings = await fetch(`${api}/merchants/me/store-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.access_token}` }, body: JSON.stringify({ registration_pending: false, plan_selection_pending: false }) });
  if (!settings.ok) throw new Error(`Account setup returned ${settings.status}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const results = await Promise.all([false, true].map(async omitCookies => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(omit => {
        if (omit) { const nativeFetch = window.fetch.bind(window); window.fetch = (input, init) => nativeFetch(input, { ...init, credentials: 'omit' }); }
        window.__expired = 0;
        window.addEventListener('aacp:session_expired', () => window.__expired++);
      }, omitCookies);
      let tracking = false;
      const calls = [];
      page.on('response', response => {
        if (tracking && response.url().startsWith(api)) calls.push({ path: new URL(response.url()).pathname.replace(/mrc_[a-z0-9-]+/g, ':merchant'), status: response.status(), bearer: !!response.request().headers().authorization });
      });
      const login = async () => {
        await expect(page.locator('#login-email')).toBeVisible();
        await page.locator('#login-email').fill(email);
        await page.locator('#login-password').fill(password);
        await page.evaluate(() => { window.__expired = 0; });
        tracking = true;
        const response = page.waitForResponse(r => r.url().endsWith('/auth/login') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Entrar', exact: true }).click();
        expect((await response).status()).toBe(201);
        await expect(page.locator('#login-email')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
      };
      try {
        await page.goto(`${dashboard}/?mode=login`);
        await login();
        await page.getByRole('button', { name: 'Produtos', exact: true }).click();
        await page.getByRole('button', { name: 'Estoque', exact: true }).click();
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.waitForTimeout(65000);
        expect(await page.evaluate(() => window.__expired)).toBe(0);
        await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
        const background = calls.filter(c => c.path.endsWith('/notifications') || c.path.endsWith('/nav-counts'));
        expect(background.filter(c => c.path.endsWith('/notifications')).length).toBeGreaterThanOrEqual(2);
        expect(background.filter(c => c.path.endsWith('/nav-counts')).length).toBeGreaterThanOrEqual(2);
        expect(calls.filter(c => c.status === 401)).toEqual([]);
        expect(background.every(c => c.status === 200 && c.bearer)).toBe(true);
        if (!omitCookies) {
          await page.reload();
          await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
          await page.waitForTimeout(1500);
          expect(await page.evaluate(() => window.__expired)).toBe(0);
        }
        tracking = false;
        const logout = page.waitForResponse(r => r.url().endsWith('/auth/logout'));
        await page.getByRole('button', { name: 'Sair', exact: true }).click();
        expect((await logout).ok()).toBe(true);
        await login();
        await page.waitForTimeout(1500);
        expect(await page.evaluate(() => window.__expired)).toBe(0);
        await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
        return { mode: omitCookies ? 'cookies omitted' : 'normal browser', login: 'PASS', navigation: 'PASS', polling65seconds: 'PASS', reload: omitCookies ? 'not tested' : 'PASS', logoutAndRelogin: 'PASS', unauthorizedAfterLogin: calls.filter(c => c.status === 401).length, backgroundRequests: background.length };
      } finally { await context.close(); }
    }));
    console.log(JSON.stringify({ result: 'PASS', realApi: true, results }, null, 2));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
