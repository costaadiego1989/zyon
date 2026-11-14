const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require('@playwright/test');
const root = path.resolve(__dirname, '../src');

// Actual React/CheckoutPanel/helper in Chromium, synthetic loopback token server
// and child widget. NOT a real API/buyer/issuer/PSP/full shopping journey proof.
const sources = { panel: 'components/CheckoutPanel.tsx', helper: 'lib/checkout-session-access.ts', boundary: 'components/CheckoutErrorBoundary.tsx' };
const modules = Object.entries(sources).map(([id, file]) => `${JSON.stringify(id)}:function(require,module,exports){${ts.transpileModule(
  fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText}\n}`).join(',');
const script = `const process={env:{NEXT_PUBLIC_API_BASE_URL:'/synthetic-api'}};const factories={${modules}},cache={};
function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};factories[id](dep=>{
 if(dep==='react')return React;
 if(dep==='react/jsx-runtime')return {jsx:(type,props,key)=>React.createElement(type,{...props,key}),jsxs:(type,props,key)=>React.createElement(type,{...props,key})};
 if(dep==='@/lib/checkout-session-access')return load('helper');
 if(dep==='./CheckoutErrorBoundary')return load('boundary');
 if(dep==='./buyer-auth'||dep==='@/lib/buyer-auth')return {getValidBuyer:()=>({token:'synthetic-buyer-proof'})};
 if(dep==='./conversation-access')return {conversationFetch:async(cart,url,init)=>{fixture.calls.push(JSON.parse(init.body));return fetch(url,{...init,headers:{...init.headers,Authorization:'Bearer synthetic-conversation-proof'}})}};
 if(dep==='@/lib/cart-store')return {useCart:()=>({cart:{cartId:fixture.cart},clearCart:()=>load('helper').forgetStorefrontCheckoutToken({merchantId:fixture.merchant,cartRef:fixture.cart})})};
 if(dep==='@/lib/api/api-client')return {cartApi:{clear:async()=>{}}};
 if(dep==='@zyon/widget-v2')return {InlineCheckout:props=>React.createElement('section',{'data-testid':'inline-fixture','data-token':props.embedToken,'data-merchant':props.merchantId},React.createElement('button',{onClick:props.onClose},'Fechar checkout'))};
 throw Error('unexpected fixture dependency '+dep);
},module,module.exports);return module.exports;}
const node=ReactDOM.createRoot(document.getElementById('root'));
window.fixture={merchant:'synthetic-merchant',cart:'synthetic-cart',calls:[],open(){const Panel=load('panel').default;node.render(React.createElement(React.StrictMode,null,React.createElement(Panel,{merchantId:this.merchant,cartRef:this.cart,globalUserId:'synthetic-buyer',onClose:()=>this.close()})))},close(){node.render(null)},clear(){load('helper').forgetStorefrontCheckoutToken({merchantId:this.merchant,cartRef:this.cart})}};`;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

test('Chromium checkout continuity against synthetic loopback upstream', { timeout: 60000 }, async t => {
  const receipts = new Map(); let issued = 0, serial = 0, deny = false;
  const server = http.createServer(async (request, response) => {
    if (request.url === '/react.js' || request.url === '/react-dom.js') {
      const pkg = request.url === '/react.js' ? 'react' : 'react-dom';
      response.setHeader('Content-Type', 'text/javascript');
      response.end(fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), `umd/${pkg}.development.js`))); return;
    }
    if (request.url !== '/api/checkout-token') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
    const binding = JSON.stringify([body.merchant_id, body.cart_ref, body.allowed_origin]);
    const previous = body.previous_embed_token && receipts.get(body.previous_embed_token);
    if (deny || request.headers.authorization !== 'Bearer synthetic-conversation-proof' || body.previous_embed_token && (!previous || previous.binding !== binding)) {
      response.statusCode = 403; response.end('{}'); return;
    }
    const nonce = previous?.nonce ?? ++issued, token = `synthetic:${nonce}:${++serial}`;
    receipts.set(token, { nonce, binding }); response.end(JSON.stringify({ embed_session_token: token, expires_at_unix: 2000000000 }));
  });
  let browser;
  t.signal.addEventListener('abort', () => { void browser?.close(); server.closeAllConnections(); }, { once: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function pageFor(work) {
    const context = await browser.newContext(), errors = [];
    try {
      await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      try { await work(page); assert.deepEqual(errors, []); }
      catch (error) { console.error(JSON.stringify({ browserFixtureFailure: true, errors,
        text: (await page.locator('body').innerText()).slice(0, 500), calls: await page.evaluate(() => window.fixture?.calls.length) })); throw error; }
    } finally { await context.close(); }
  }
  const opened = async page => { await page.evaluate(() => fixture.open()); const inline = page.getByTestId('inline-fixture'); await inline.waitFor(); return inline.getAttribute('data-token'); };
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-background-networking'] });
    await t.test('StrictMode first mount and close/reopen keep one checkout nonce', () => pageFor(async page => {
      const before = issued, first = await opened(page); assert.equal(issued, before + 1);
      await page.getByRole('button', { name: 'Fechar checkout' }).click(); await page.getByTestId('inline-fixture').waitFor({ state: 'detached' });
      const next = await opened(page); assert.equal(receipts.get(next).nonce, receipts.get(first).nonce);
      assert.equal(await page.evaluate(() => fixture.calls.length), 2); assert.equal(issued, before + 1);
    }));
    await t.test('page reload restores tab proof and asks upstream to continue the same checkout', () => pageFor(async page => {
      const first = await opened(page); await page.reload(); const next = await opened(page);
      assert.equal(receipts.get(next).nonce, receipts.get(first).nonce);
      assert.equal(await page.evaluate(() => fixture.calls[0].previous_embed_token), first);
    }));
    await t.test('server refusal preserves proof and uses existing error/Voltar UI without fresh fallback', () => pageFor(async page => {
      const first = await opened(page), before = issued;
      await page.evaluate(() => fixture.close()); await page.getByTestId('inline-fixture').waitFor({ state: 'detached' });
      deny = true;
      try { await page.evaluate(() => fixture.open()); await page.getByRole('button', { name: 'Voltar', exact: true }).waitFor();
        assert.equal(await page.getByTestId('inline-fixture').count(), 0); assert.equal(issued, before);
        assert.equal(await page.evaluate(() => fixture.calls.at(-1).previous_embed_token), first);
      } finally { deny = false; }
    }));
    await t.test('new merchant/cart never receives the previous checkout token', () => pageFor(async page => {
      const first = await opened(page); await page.evaluate(() => { fixture.close(); fixture.merchant = 'other-merchant'; fixture.cart = 'other-cart'; });
      await page.getByTestId('inline-fixture').waitFor({ state: 'detached' }); const next = await opened(page);
      assert.notEqual(receipts.get(next).nonce, receipts.get(first).nonce);
      assert.equal(await page.evaluate(() => fixture.calls.at(-1).previous_embed_token), undefined);
      assert.equal(await page.getByTestId('inline-fixture').getAttribute('data-merchant'), 'other-merchant');
    }));
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(server.listening, false); console.log(JSON.stringify({ browserClosed: true, loopbackServerClosed: true, providerCalls: 0 })); }
});
