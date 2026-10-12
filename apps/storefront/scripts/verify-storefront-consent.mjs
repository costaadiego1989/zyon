import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.CONSENT_STOREFRONT_URL;
assert.ok(origin?.startsWith('https://'), 'HTTPS storefront URL is required');
const phase = process.env.CONSENT_PHASE ?? 'sandbox';
const mode = process.env.CONSENT_MODE ?? 'guest';
const slug = process.env.CONSENT_STORE_SLUG ?? 'demo';
const directory = path.resolve(process.env.CONSENT_EVIDENCE_DIR ?? `../../.audit/storefront-consent-20261005/${phase}`);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const result = { phase, mode, storefront: origin, storeSlug: slug, checks: [], pageErrors: [], failedApiRequests: [], consentFailures: [], checkoutFailures: [] };
const check = (name) => result.checks.push(name);
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => { localStorage.setItem('zyon-theme', 'light'); localStorage.setItem('pulse-channel-pref', 'chat'); });
  const page = await context.newPage();
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500 && new URL(response.url()).origin === origin) result.failedApiRequests.push({ path: new URL(response.url()).pathname, status: response.status() });
    if (response.status() >= 400 && response.url().endsWith('/contact-consent')) result.consentFailures.push({ status: response.status(), method: response.request().method() });
    if (response.status() >= 400 && new URL(response.url()).pathname.includes('checkout')) result.checkoutFailures.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  const configResponse = await page.request.get(`${origin}/api/v1/storefront/${slug}/config`);
  assert.equal(configResponse.status(), 200, 'Real storefront config must load');
  const config = await configResponse.json();
  const merchantId = config.merchantId;
  assert.ok(merchantId, 'Real config must identify the merchant');
  result.merchantId = merchantId;
  const key = `zyon-storefront-consent:${merchantId}`;
  const consentUrl = `${origin}/api/v1/storefront/stores/${encodeURIComponent(merchantId)}/contact-consent`;
  const dialog = page.getByRole('dialog', { name: 'Sua privacidade nesta loja' });
  await page.goto(`${origin}/store/${slug}`, { waitUntil: 'domcontentloaded' });
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  await dialog.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  const screenshot = async (name) => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(directory, name), fullPage: true, animations: 'disabled' }); };
  await screenshot('mobile-consent.png');
  if (mode === 'capture') {
    await page.setViewportSize({ width: 1440, height: 900 });
    await screenshot('desktop-consent.png');
    check('mobile and desktop captures from deployed storefront');
  } else {
    const email = dialog.getByRole('checkbox', { name: 'E-mail', exact: true });
    const whatsapp = dialog.getByRole('checkbox', { name: 'WhatsApp', exact: true });
    assert.equal(await email.isChecked(), false);
    assert.equal(await whatsapp.isChecked(), false);
    assert.equal(await page.getByRole('button', { name: 'Explorar lojas parceiras', exact: true }).count(), 0);
    assert.equal(await page.getByText('Online', { exact: true }).count(), 0);
    const logo = page.locator('#storefront-chat .conversation-header > img');
    if (await logo.count()) {
      assert.equal(await logo.evaluate((element) => Math.round(element.getBoundingClientRect().width)), 44);
      result.logoWidth = 44;
    } else result.logoWidth = 'store uses a monogram';
    const sheetBounds = await dialog.boundingBox();
    assert.ok(sheetBounds && Math.abs(sheetBounds.y + sheetBounds.height - 844) < 2, 'Sheet must be anchored at the bottom');
    await page.keyboard.press('Escape');
    await page.mouse.click(4, 4);
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), null);
    check('persistent mobile bottom sheet; no close by Escape or backdrop; optional channels unchecked');
    await dialog.getByRole('button', { name: 'Não aceito', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const choice = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), key));
    assert.deepEqual(choice.channels, []);
    assert.equal(choice.optionalCookies, false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Cookies e contato', exact: true }).waitFor();
    assert.equal(await dialog.isVisible(), false);
    await screenshot('mobile-storefront.png');
    check('refusal saved and not requested again after reload; header and mobile logo updated');
    const unauthenticated = await page.request.get(consentUrl);
    assert.equal(unauthenticated.status(), 401, 'Contact preferences require buyer authentication');
    check('real unauthenticated consent endpoint returns 401');
    if (mode === 'server') {
      assert.equal(phase, 'sandbox', 'Contact mutations are limited to sandbox fixtures');
      const fixture = JSON.parse(process.env.CONSENT_TEST_BUYER_JSON ?? '{}');
      assert.match(fixture.globalUserId ?? '', /^consent_qa_[a-f0-9]{32}$/);
      const login = await page.request.post(`${origin}/api/v1/buyer/login`, { data: { email: fixture.email, password: fixture.password } });
      assert.equal(login.status(), 201, 'Fixture must authenticate through the real buyer login');
      const auth = await login.json();
      const token = auth.accessToken ?? auth.access_token ?? auth.token;
      const globalUserId = auth.globalUserId ?? auth.global_user_id;
      assert.ok(token && globalUserId === fixture.globalUserId, 'Login must issue buyer-owned token');
      const authorized = await page.request.get(consentUrl, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(authorized.status(), 200, 'Authenticated buyer must access the real storefront consent endpoint');
      check('real buyer login and authenticated consent access');
      await page.evaluate(({ token, globalUserId, email }) => {
        localStorage.setItem('zyon_buyer_token', token);
        localStorage.setItem('zyon_buyer_session', JSON.stringify({ token, globalUserId, email }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'zyon_buyer_token' }));
      }, { token, globalUserId, email: fixture.email });
      result.authTiming = await page.evaluate(() => {
        const token = localStorage.getItem('zyon_buyer_token');
        const payload = token ? JSON.parse(atob(token.split('.')[1])) : null;
        return { tokenPresent: Boolean(token), issuedAt: payload?.iat, expiresAt: payload?.exp, browserNow: Math.floor(Date.now() / 1000) };
      });
      await page.waitForFunction((key) => { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); return saved && saved.pendingContactSync === false; }, key, { timeout: 30_000 });
      const readServer = async () => {
        const response = await page.request.get(consentUrl, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(response.status(), 200);
        return response.json();
      };
      assert.deepEqual((await readServer()).channels, []);
      check('guest refusal synchronized to the authenticated buyer');
      await page.getByRole('button', { name: 'Cookies e contato', exact: true }).click();
      await email.check();
      await dialog.getByRole('button', { name: 'Aceitar seleção', exact: true }).click();
      await page.waitForFunction((key) => { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); return saved?.pendingContactSync === false && saved.channels.includes('email'); }, key, { timeout: 30_000 });
      assert.deepEqual((await readServer()).channels, ['email']);
      check('email permission persisted and read back from the server');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Cookies e contato', exact: true }).click();
      await page.waitForFunction(() => { const input = [...document.querySelectorAll('dialog fieldset input')].find((element) => element.closest('label')?.textContent?.includes('E-mail')); return input?.checked; }, null, { timeout: 30_000 });
      assert.equal(await whatsapp.isChecked(), false);
      await dialog.getByRole('button', { name: 'Não aceito', exact: true }).click();
      await page.waitForFunction((key) => { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); return saved?.pendingContactSync === false && saved.channels.length === 0; }, key, { timeout: 30_000 });
      assert.deepEqual((await readServer()).channels, []);
      const invalid = await page.request.put(consentUrl, { headers: { Authorization: `Bearer ${token}` }, data: { channels: ['sms'], policy_version: choice.version, decided_at: new Date().toISOString() } });
      assert.equal(invalid.status(), 400);
      check('real login, refusal replay, email grant, server readback after reload, revocation and invalid input rejection');
    }
    if (mode === 'checkout' || (mode === 'server' && process.env.CONSENT_CHECKOUT === '1')) {
      assert.equal(phase, 'sandbox', 'Cart validation is limited to sandbox');
      await page.getByRole('button', { name: /^Ver produtos$/i }).first().click();
      const add = page.getByRole('button', { name: 'Adicionar ao carrinho', exact: true }).first();
      await add.waitFor({ state: 'visible', timeout: 60_000 });
      await add.click();
      const finish = page.getByRole('button', { name: /^Finalizar (compra|pedido)$/i }).first();
      try { await finish.waitFor({ state: 'visible', timeout: 15_000 }); }
      catch { await page.getByRole('button', { name: /Carrinho:/ }).click(); }
      await finish.waitFor({ state: 'visible', timeout: 30_000 });
      await finish.click();
      await page.getByRole('button', { name: 'Voltar para o site', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
      const channel = page.getByRole('button', { name: /Por chat/ });
      if (await channel.isVisible()) await channel.click();
      await page.getByPlaceholder('Escreva sua mensagem...').waitFor({ state: 'visible', timeout: 30_000 });
      assert.equal(await page.getByText('Preferências de contato desta loja', { exact: true }).count(), 0);
      assert.equal(await page.locator('.pulse-widget-shell span[style*="var(--dot)"]').count(), 0);
      await screenshot('mobile-checkout.png');
      check('real catalog, add-to-cart and checkout composer; contact block and online dot removed');
    }
    for (const policy of ['cookies', 'privacidade', 'termos']) {
      await page.goto(`${origin}/politicas/${policy}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { level: 1 }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const footer = page.getByRole('link', { name: 'zyonagenticcommerce@gmail.com', exact: true });
      await footer.scrollIntoViewIfNeeded();
      assert.equal(await footer.isVisible(), true);
      await screenshot(`mobile-policy-${policy}.png`);
    }
    check('all three policies render and scroll to the contact footer on mobile');
    assert.deepEqual(result.pageErrors, [], 'Deployed storefront must have no uncaught browser errors');
    assert.deepEqual(result.failedApiRequests, [], 'Deployed storefront must have no API server failures');
  }
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = error.message;
  const activePage = browser.contexts()[0]?.pages()[0];
  if (activePage) await activePage.screenshot({ path: path.join(directory, `${mode}-failure.png`), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(path.join(directory, `${mode}-results.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
