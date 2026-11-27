const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require('@playwright/test');

// Actual component, services and gestures in Chromium. Loopback upstream and
// intercepted chat popup are synthetic; real Meta acceptance is a release gate.
const sources = { component: 'components/buyer-hub/CashbackWhatsAppLink.tsx', service: 'lib/services/cashback.service.ts' };
const modules = Object.entries(sources).map(([id, file]) => `${JSON.stringify(id)}:function(require,module,exports){${ts.transpileModule(
  fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText}\n}`).join(',');
const script = `const factories={${modules}},cache={};
function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};factories[id](dep=>{
 if(dep==='react')return React;
 if(dep==='react/jsx-runtime')return {jsx:(type,props,key)=>React.createElement(type,{...props,key}),jsxs:(type,props,key)=>React.createElement(type,{...props,key})};
 if(dep.endsWith('.module.css'))return {};
 if(dep==='../../lib/services/cashback.service')return load('service');
 if(dep==='./http')return {apiCall:async(url,init)=>{const response=await fetch(url,{...init,headers:{'content-type':'application/json',authorization:'Bearer synthetic-buyer'}});if(!response.ok)throw Error('synthetic '+response.status);return response.json()}};
 throw Error('unexpected dependency '+dep);
},module,module.exports);return module.exports;}
const node=ReactDOM.createRoot(document.getElementById('root'));
window.fixture={linked:0,mount(merchant='store-a'){node.render(React.createElement(React.StrictMode,null,React.createElement(load('component').CashbackWhatsAppLink,{merchantId:merchant,onLinked:()=>this.linked++})))},close(){node.render(null)}};
fixture.mount();`;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

test('C5 Chromium explicit WhatsApp linking gestures and lifecycle', { timeout: 60000 }, async t => {
  let browser, fixture = {}, externalRequests = 0;
  function reset() { fixture = { mode: 'pending', starts: [], polls: [], held: [], failStart: false, failPoll: false, hold: false, ttl: 300000 }; }
  reset();
  const server = http.createServer(async (request, response) => {
    if (request.url === '/react.js' || request.url === '/react-dom.js') {
      const pkg = request.url === '/react.js' ? 'react' : 'react-dom'; response.setHeader('content-type', 'text/javascript');
      response.end(fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), `umd/${pkg}.development.js`))); return;
    }
    if (!request.url.startsWith('/buyer/')) { response.setHeader('content-type', 'text/html'); response.end(html); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== 'Bearer synthetic-buyer') { response.statusCode = 401; response.end('{}'); return; }
    if (request.url.endsWith('/inbound/status')) {
      fixture.polls.push(body);
      if (fixture.hold) { fixture.held.push(response); return; }
      if (fixture.failPoll) { response.statusCode = 503; response.end('{}'); return; }
      response.end(JSON.stringify({ status: fixture.mode, linked: fixture.mode === 'confirmed', phone: fixture.mode === 'confirmed' ? '+55 (***) *****-1111' : null })); return;
    }
    if (request.url.endsWith('/inbound')) {
      fixture.starts.push(body);
      if (fixture.failStart) { response.statusCode = 503; response.end('{}'); return; }
      const token = 'A'.repeat(42) + fixture.starts.length;
      response.end(JSON.stringify({ token, url: 'https://wa.me/5511999999999?text=' + encodeURIComponent('Vincular minha conta ' + token), expiresAt: new Date(Date.now() + fixture.ttl).toISOString(), phone: '***1111' })); return;
    }
    if (request.method !== 'GET') { response.statusCode = 400; response.end('{}'); return; }
    response.end(JSON.stringify({ linked: false, phone: null }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function pageFor(work) {
    reset(); const context = await browser.newContext(), errors = [];
    try {
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        if (url.origin === 'https://wa.me') return route.fulfill({ contentType: 'text/html', body: '<p>Synthetic official chat popup</p>' });
        externalRequests++; return route.abort();
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', e => errors.push(e.message));
      await page.goto(base); await page.getByRole('button', { name: 'Confirmar pelo WhatsApp', exact: true }).waitFor();
      await work(page); assert.deepEqual(errors, []);
    } finally { for (const held of fixture.held) held.end('{}'); await context.close(); }
  }
  const start = async page => {
    await page.getByLabel('Número do WhatsApp', { exact: true }).fill('+55 11 99000-1111');
    await page.getByRole('button', { name: 'Confirmar pelo WhatsApp', exact: true }).click();
    await page.getByRole('link', { name: 'Abrir WhatsApp da loja' }).waitFor();
  };
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-background-networking'] });
    await t.test('invalid phone shows a visible error before creating a challenge', () => pageFor(async page => {
      await page.getByLabel('Número do WhatsApp', { exact: true }).fill('123');
      await page.getByRole('button', { name: 'Confirmar pelo WhatsApp', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Informe seu WhatsApp' }).waitFor(); assert.equal(fixture.starts.length, 0);
    }));
    await t.test('prepare/open actual popup/confirm polling uses exact merchant and phone without OTP or consent', () => pageFor(async page => {
      await start(page); assert.deepEqual(fixture.starts, [{ phone: '+5511990001111', merchantId: 'store-a' }]);
      await page.getByRole('status').filter({ hasText: 'envie a mensagem preparada' }).waitFor();
      const href = await page.getByRole('link', { name: 'Abrir WhatsApp da loja' }).getAttribute('href');
      assert.equal(new URL(href).searchParams.get('text'), 'Vincular minha conta ' + 'A'.repeat(42) + '1');
      const popup = page.waitForEvent('popup'); await page.getByRole('link', { name: 'Abrir WhatsApp da loja' }).click();
      const chat = await popup; await chat.getByText('Synthetic official chat popup').waitFor(); await chat.close();
      fixture.mode = 'confirmed'; await page.getByRole('button', { name: 'Verificar novamente' }).click();
      await page.getByRole('status').filter({ hasText: 'WhatsApp vinculado' }).waitFor();
      assert.match(await page.getByRole('status').innerText(), /1111/); assert.equal(await page.evaluate(() => window.fixture.linked), 1);
      assert.ok(fixture.polls.every(p => p.token === 'A'.repeat(42) + '1')); assert.equal(await page.getByRole('checkbox').count(), 0);
    }));
    for (const mode of ['cancelled', 'expired']) await t.test(mode + ' status returns to form with a specific visible message', () => pageFor(async page => {
      await start(page); fixture.mode = mode; await page.getByRole('button', { name: 'Verificar novamente' }).click();
      await page.getByRole('alert').filter({ hasText: mode === 'cancelled' ? 'cancelou' : 'expirou' }).waitFor();
      await page.getByRole('button', { name: 'Confirmar pelo WhatsApp', exact: true }).waitFor();
      assert.equal(await page.getByText('WhatsApp vinculado', { exact: true }).count(), 0);
    }));
    await t.test('creation failure stays visible and never exposes a chat capability', () => pageFor(async page => {
      fixture.failStart = true; await page.getByLabel('Número do WhatsApp', { exact: true }).fill('+55 11 99000-1111');
      await page.getByRole('button', { name: 'Confirmar pelo WhatsApp', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Não foi possível preparar' }).waitFor();
      assert.equal(await page.getByRole('link').count(), 0);
    }));
    await t.test('poll error is retryable through the actual button', () => pageFor(async page => {
      fixture.failPoll = true; await start(page); await page.getByRole('alert').filter({ hasText: 'Não foi possível consultar' }).waitFor();
      fixture.failPoll = false; fixture.mode = 'confirmed'; await page.getByRole('button', { name: 'Verificar novamente' }).click();
      await page.getByRole('status').filter({ hasText: 'WhatsApp vinculado' }).waitFor();
    }));
    await t.test('merchant change ignores obsolete successful polling and stops its timer', () => pageFor(async page => {
      fixture.hold = true; await start(page);
      await page.waitForFunction(() => document.querySelector('a') !== null);
      await page.evaluate(() => fixture.mount('store-b'));
      await page.getByRole('button', { name: 'Confirmar pelo WhatsApp', exact: true }).waitFor();
      for (const held of fixture.held) held.end(JSON.stringify({ status: 'confirmed', linked: true, phone: '***1111' }));
      const count = fixture.polls.length; await page.waitForTimeout(2800);
      assert.equal(fixture.polls.length, count); assert.equal(await page.getByText('WhatsApp vinculado', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.fixture.linked), 0);
    }));
    await t.test('unmount aborts polling and no subsequent status request runs', () => pageFor(async page => {
      await start(page); await page.evaluate(() => fixture.close()); const count = fixture.polls.length;
      await page.waitForTimeout(2800); assert.equal(fixture.polls.length, count);
    }));
    await t.test('local five-minute deadline stops pending polling with explicit expiry', () => pageFor(async page => {
      await page.clock.install(); await start(page); await page.clock.fastForward(300001);
      await page.getByRole('alert').filter({ hasText: 'expirou' }).waitFor();
      assert.equal(await page.getByRole('link').count(), 0);
    }));
    assert.equal(externalRequests, 0);
  } finally {
    for (const held of fixture.held) held.end('{}'); if (browser) await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); assert.equal(server.listening, false);
  }
});
