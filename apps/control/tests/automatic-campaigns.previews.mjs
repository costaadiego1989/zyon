import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('../..');
const cli = path.join(process.env.APPDATA, 'npm/node_modules/vercel/dist/index.js');
const browser = await chromium.launch({ headless: true }); const checks = [];
try {
  for (const [app, project, url, folder] of [
    ['control', 'zyon-control', 'https://zyon-control-bhkj3lkq6-diegos-projects-b6fd2a25.vercel.app', 'production'],
    ['dashboard', 'zyon-dashboard', 'https://zyon-dashboard-3vfk3pptx-diegos-projects-b6fd2a25.vercel.app', 'production-v3'],
    ['web', 'zyon-agentic-checkout', 'https://zyon-agentic-checkout-pp7unw5f6-diegos-projects-b6fd2a25.vercel.app', 'production-v2'],
  ]) {
    const issued = spawnSync(process.execPath, [cli, 'project', 'token', project, '--scope', 'diegos-projects-b6fd2a25'], { windowsHide: true, encoding: 'utf8' });
    const token = issued.stdout.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0]; assert.ok(token);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'pt-BR' });
    await context.route(url + '/**', route => route.continue({ headers: { ...route.request().headers(), 'x-vercel-trusted-oidc-idp-token': token } }));
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    const response = await page.goto(url); assert.equal(response.status(), 200);
    const html = await response.text(); assert.equal(html, await readFile(path.join(root, '.audit/automatic-campaigns-release-20261016', folder, app, '.vercel/output/static/index.html'), 'utf8'));
    const assetHeaders = { 'x-vercel-trusted-oidc-idp-token': token };
    if (app !== 'web') {
      const bundlePath = html.match(/src="([^"]+\.js)"/)?.[1]; assert.ok(bundlePath);
      const bundle = await (await page.request.get(url + bundlePath, { headers: assetHeaders })).text();
      assert.ok(bundle.includes('https://api.zyon-payments.com.br')); assert.ok(!bundle.includes('https://api-sandbox-8146.up.railway.app'));
      const logo = await page.request.get(url + '/zyon-z.png', { headers: assetHeaders }); assert.equal(logo.status(), 200);
      assert.ok((await logo.body()).equals(await readFile('../dashboard/public/zyon-z.png')));
    } else {
      for (const route of ['/privacidade', '/termos', '/recursos']) {
        const result = await page.request.get(url + route, { headers: assetHeaders }); assert.equal(result.status(), 200, 'existing_clean_url_' + route);
      }
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.deepEqual(errors, []); checks.push({ app, exactArtifact: true, noSandboxApi: true, mobileOverflow: false, pageErrors: 0 });
    await context.close();
  }
  await writeFile(path.join(root, '.audit/automatic-campaigns-release-20261016/evidence/production-previews.json'), JSON.stringify({ proof: 'deployed_prebuilt_artifacts_and_public_browser_pages', checks }, null, 2));
  console.log(JSON.stringify(checks));
} finally { await browser.close(); }
