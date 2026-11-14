const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
const sourceRoot = path.resolve(__dirname, '../src');
const plain = value => JSON.parse(JSON.stringify(value));
function dto() {
  return { version: 1, merchantId: 'merchant-a', cartId: 'conversation-a', variantId: 'variant-added', productId: 'product-added',
    sku: 'sku-added', promotionId: 'promotion-a', promotionUpdatedAt: '2026-10-18T12:00:00.000Z', quantity: 1,
    originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000,
    cartBasis: { items: [{ variantId: 'variant-existing', productId: 'product-existing', sku: 'sku-existing', name: 'Existing', quantity: 2, unitPriceCents: 5000 }], total: 10000, discount: 0, couponCode: null, freeShipping: false },
    quote: { currency: 'BRL', originalSubtotalCents: 20000, promotionDiscountCents: 1000, subtotalCents: 19000, merchandiseTotalCents: 18500,
      items: [{ variantId: 'variant-existing', productId: 'product-existing', quantity: 2, baseUnitPriceCents: 5000, unitPriceCents: 5000 },
        { variantId: 'variant-added', productId: 'product-added', quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 9000 }] } };
}
function runtime(fetchImpl, realAccess = false) {
  const cache = new Map(), calls = [];
  const storage = new Map();
  const context = vm.createContext({ console, URL, URLSearchParams, Headers, Response, Date, BigInt, setTimeout, clearTimeout,
    atob, window: { location: { origin: 'https://store.fixture.invalid' } },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    process: { env: { NEXT_PUBLIC_API_BASE_URL: 'https://api.fixture.invalid' } },
    fetch: async (url, init) => {
      if (!realAccess || !fetchImpl) throw new Error('unexpected_real_fetch');
      const call = { url: String(url), ...init }; calls.push(call); return fetchImpl(call, calls);
    } });
  function load(relative) {
    const filename = path.isAbsolute(relative) ? relative : path.join(sourceRoot, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const localRequire = id => {
      if (!realAccess && (id === '@/lib/conversation-access' || id === '../conversation-access')) return {
        rememberConversationAccess: () => {}, conversationFetch: async (conversationId, url, options, policy) => {
          const init = typeof options === 'function' ? options() : options;
          const call = { conversationId, url, ...init, policy }; calls.push(call);
          if (!fetchImpl) throw new Error('unexpected_transport'); return fetchImpl(call, calls);
        } };
      if (id === '@/lib/services/http') return { apiCall: () => { throw new Error('unexpected_api_call'); } };
      if (id.startsWith('@/') || id.startsWith('.')) {
        const base = id.startsWith('@/') ? path.join(sourceRoot, id.slice(2)) : path.resolve(path.dirname(filename), id);
        const target = [base, base + '.ts', base + '.tsx', base.replace(/\.js$/, '.ts')].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        if (!target) throw new Error('missing_quote_source:' + id); return load(target);
      }
      return require(id);
    };
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return { load, calls };
}
const selection = () => ({ variantId: 'variant-added', promotionId: 'promotion-a', quantity: 1 });
const ack = () => ({ version: 1, status: 'accepted', merchantId: 'merchant-a', cartId: 'conversation-a' });
const pending = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const token = expired => `${Buffer.from(JSON.stringify({ origin: 'https://store.fixture.invalid', expiresAt: Date.now() / 1000 + (expired ? -1 : 3600) })).toString('base64url')}.synthetic`;
test('strict browser quote clones the real canonical V1 DTO and preserves B/P/D without applying it', () => {
  const parse = runtime().load('lib/cross-sell-quote.ts').parseCrossSellQuote, input = dto();
  const parsed = parse(input); assert.deepEqual(plain(parsed), input);
  input.quote.items[0].quantity = 99; input.cartBasis.items[0].name = 'mutated';
  assert.equal(parsed.quote.items[0].quantity, 2); assert.equal(parsed.cartBasis.items[0].name, 'Existing');
});
const quoteMutations = [
  ['unknown root', q => { q.token = 'private'; }], ['unknown nested', q => { q.quote.items[0].cost = 1; }],
  ['undefined extra', q => { q.token = undefined; }], ['undefined nested extra', q => { q.cartBasis.items[0].cost = undefined; }],
  ['wrong version', q => { q.version = 2; }], ['blank id', q => { q.variantId = ' '; }], ['NUL id', q => { q.sku = 'x\0y'; }],
  ['unpaired surrogate', q => { q.productId = '\ud800'; }], ['invalid date', q => { q.promotionUpdatedAt = 'not-date'; }],
  ['currency', q => { q.quote.currency = 'USD'; }], ['fractional money', q => { q.maximumUnitPriceCents = 1.1; }],
  ['overflow', q => { q.quote.subtotalCents = 2147483648; }], ['sum', q => { q.quote.originalSubtotalCents++; }],
  ['promotion double counted', q => { q.quote.merchandiseTotalCents = 19001; }], ['duplicate line', q => { q.quote.items.push({ ...q.quote.items[0] }); }],
  ['target identity', q => { q.quote.items[1].productId = 'foreign'; }], ['target quantity', q => { q.quantity = 2; }],
  ['target base', q => { q.originalUnitPriceCents++; }], ['target effective', q => { q.maximumUnitPriceCents--; }],
  ['existing target', q => { q.cartBasis.items[0].variantId = q.variantId; }], ['basis sum', q => { q.cartBasis.total++; }],
  ['coupon', q => { q.cartBasis.couponCode = 'COUPON'; }], ['shipping', q => { q.cartBasis.freeShipping = true; }],
  ['options unsupported', q => { q.cartBasis.items[0].selectedOptions = ['option']; }],
  ['invalid notice', q => { q.quote.commercialNotices = [{ version: 1, code: 'invented', message: 'unsafe' }]; }],
];
for (const [name, mutate] of quoteMutations) test(`quote rejects ${name}`, () => {
  const parse = runtime().load('lib/cross-sell-quote.ts').parseCrossSellQuote, value = dto(); mutate(value);
  assert.throws(() => parse(value));
});
test('transport quotes and accepts via distinct POSTs with captured scope, exact JSON and explicit no replay', async () => {
  const f = runtime(call => Response.json(call.url.endsWith('/quote') ? dto() : ack()));
  const client = f.load('lib/api/api-client.ts').crossSellApi;
  assert.deepEqual(plain(await client.quote('merchant-a', 'conversation-a', 'conversation-a', selection())), dto());
  assert.deepEqual(plain(await client.accept('merchant-a', 'conversation-a', 'conversation-a', dto())), ack());
  assert.deepEqual(f.calls.map(call => [call.method, call.conversationId, call.policy.replayAuthorizationFailure]), [['POST', 'conversation-a', false], ['POST', 'conversation-a', false]]);
  assert.equal(f.calls[0].url, 'https://api.fixture.invalid/storefront/merchant-a/cart/conversation-a/cross-sell/quote');
  assert.deepEqual(JSON.parse(f.calls[0].body), selection()); assert.deepEqual(JSON.parse(f.calls[1].body), { expectedQuote: dto() });
});
for (const status of [401, 403, 409, 422, 500]) test(`transport ${status} never retries or interprets an error body as quote`, async () => {
  const f = runtime(() => Response.json({ ...dto(), code: 'cross_sell_quote_review_required' }, { status }));
  await assert.rejects(f.load('lib/api/api-client.ts').crossSellApi.quote('merchant-a', 'conversation-a', 'conversation-a', selection()));
  assert.equal(f.calls.length, 1);
});
test('transport rejects malformed request and foreign quote before sending acceptance', async () => {
  const f = runtime(() => Response.json(dto())), api = f.load('lib/api/api-client.ts').crossSellApi;
  await assert.rejects(api.quote('merchant-a', 'conversation-a', 'conversation-a', { ...selection(), productId: 'wrong' }));
  await assert.rejects(api.accept('merchant-b', 'conversation-a', 'conversation-a', dto())); assert.equal(f.calls.length, 0);
});
test('transport rejects an undefined extra instead of deleting it before strict validation', async () => {
  const f = runtime(() => Response.json(dto())), api = f.load('lib/api/api-client.ts').crossSellApi;
  await assert.rejects(api.quote('merchant-a', 'conversation-a', 'conversation-a', { ...selection(), productId: undefined }));
  assert.equal(f.calls.length, 0);
});
for (const [name, scope] of [
  ['blank merchant', [' ', 'conversation-a', 'conversation-a']],
  ['malformed merchant', ['merchant\0a', 'conversation-a', 'conversation-a']],
  ['oversized cart', ['merchant-a', 'x'.repeat(192), 'x'.repeat(192)]],
  ['different conversation', ['merchant-a', 'conversation-a', 'conversation-b']],
]) test(`scope ${name} rejects both POSTs before IO`, async () => {
  const f = runtime(() => Response.json(dto())), api = f.load('lib/api/api-client.ts').crossSellApi;
  await assert.rejects(api.quote(...scope, selection())); await assert.rejects(api.accept(...scope, dto())); assert.equal(f.calls.length, 0);
});
for (const field of ['merchantId', 'cartId', 'variantId', 'promotionId', 'quantity']) test(`quote response binds exact requested ${field}`, async () => {
  const value = dto(); if (field === 'quantity') value.quantity = 2; else value[field] = 'foreign';
  const f = runtime(() => Response.json(value));
  await assert.rejects(f.load('lib/api/api-client.ts').crossSellApi.quote('merchant-a', 'conversation-a', 'conversation-a', selection())); assert.equal(f.calls.length, 1);
});
for (const value of [undefined, { ...ack(), version: 2 }, { ...ack(), status: 'pending' }, { ...ack(), merchantId: 'foreign' },
  { ...ack(), cartId: 'foreign' }, { ...ack(), cart: dto().quote }, { ...ack(), token: 'private' }]) test(`accept acknowledgement is strict and is never a cart: ${JSON.stringify(value)}`, async () => {
  const f = runtime(() => value === undefined ? new Response('not-json') : Response.json(value));
  await assert.rejects(f.load('lib/api/api-client.ts').crossSellApi.accept('merchant-a', 'conversation-a', 'conversation-a', dto())); assert.equal(f.calls.length, 1);
});
test('ack parser rejects an own undefined extra before JSON serialization and never treats ack as a cart', () => {
  const parse = runtime().load('lib/cross-sell-quote.ts').parseCrossSellAcceptance;
  assert.throws(() => parse({ ...ack(), token: undefined }, 'merchant-a', 'conversation-a'));
  assert.deepEqual(plain(parse(ack(), 'merchant-a', 'conversation-a')), ack());
});
test('valid existing intent and bounded notices remain detached server preconditions, never extra grants', () => {
  const parse = runtime().load('lib/cross-sell-quote.ts').parseCrossSellQuote, input = dto();
  input.cartBasis.items[0].crossSellIntent = { version: 1, promotionId: 'prior-promo', promotionUpdatedAt: '2026-10-18T12:00:00+03:00', acceptedQuantity: 2, originalUnitPriceCents: 5000, maximumUnitPriceCents: 5000 };
  input.cartBasis.items[0].selectedOptions = [];
  input.quote.commercialNotices = [{ version: 1, code: 'discount_limit_reached', message: 'O limite de desconto foi atingido.' }];
  const parsed = parse(input); assert.deepEqual(plain(parsed), input);
  input.cartBasis.items[0].crossSellIntent.maximumUnitPriceCents = 1; input.quote.commercialNotices[0].message = 'mutated';
  assert.equal(parsed.cartBasis.items[0].crossSellIntent.maximumUnitPriceCents, 5000);
  assert.notEqual(parsed.quote.commercialNotices[0].message, 'mutated');
});
const intentNoticeMutations = [
  ['intent extra', q => { q.cartBasis.items[0].crossSellIntent = { version: 1, promotionId: 'p', promotionUpdatedAt: q.promotionUpdatedAt, acceptedQuantity: 1, originalUnitPriceCents: 1, maximumUnitPriceCents: 1, authorized: true }; }],
  ['intent unknown version', q => { q.cartBasis.items[0].crossSellIntent = { version: 2, promotionId: 'p', promotionUpdatedAt: q.promotionUpdatedAt, acceptedQuantity: 1, originalUnitPriceCents: 1, maximumUnitPriceCents: 1 }; }],
  ['invalid calendar', q => { q.promotionUpdatedAt = '2026-02-30T12:00:00Z'; }],
  ['notice blank', q => { q.quote.commercialNotices = [{ version: 1, code: 'discount_limit_reached', message: ' ' }]; }],
  ['notice extra', q => { q.quote.commercialNotices = [{ version: 1, code: 'discount_limit_reached', message: 'Bounded', cost: 1 }]; }],
  ['notice oversized group', q => { q.quote.commercialNotices = Array.from({ length: 6 }, () => ({ version: 1, code: 'discount_limit_reached', message: 'Bounded' })); }],
];
for (const [name, mutate] of intentNoticeMutations) test(`quote rejects ${name}`, () => {
  const value = dto(); mutate(value); assert.throws(() => runtime().load('lib/cross-sell-quote.ts').parseCrossSellQuote(value));
});
for (const quantity of [1, 99]) test(`request accepts bounded quantity ${quantity} and preserves Unicode IDs exactly`, () => {
  const parse = runtime().load('lib/cross-sell-quote.ts').parseCrossSellSelection;
  const input = { variantId: 'variante-é-🍀', promotionId: ' p ', quantity };
  assert.deepEqual(plain(parse(input)), input);
});
for (const quantity of [0, 100, 1.1, NaN, '1']) test(`request rejects quantity ${String(quantity)} without coercion`, () => {
  assert.throws(() => runtime().load('lib/cross-sell-quote.ts').parseCrossSellSelection({ ...selection(), quantity }));
});
for (const instant of ['2026-10-18T12:00Z', '2026-10-18T12:00+03:00', '0000-02-29T12:00:00Z']) test(`quote preserves valid backend ISO instant ${instant}`, () => {
  const value = dto(); value.promotionUpdatedAt = instant;
  assert.equal(runtime().load('lib/cross-sell-quote.ts').parseCrossSellQuote(value).promotionUpdatedAt, instant);
});
for (const method of ['quote', 'accept']) for (const status of [401, 403, 409, 422, 500]) test(`real conversation transport ${method}/${status}: one POST, no renew/replay/fallback`, async () => {
  const f = runtime(() => Response.json({ code: 'cross_sell_quote_review_required' }, { status }), true);
  f.load('lib/conversation-access.ts').rememberConversationAccess('conversation-a', token());
  await assert.rejects(f.load('lib/api/api-client.ts').crossSellApi[method]('merchant-a', 'conversation-a', 'conversation-a', method === 'quote' ? selection() : dto()));
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].url, '/api/storefront-proxy/merchant-a/cart/conversation-a/cross-sell/' + method);
  assert.match(f.calls[0].headers.get('Authorization'), /^Bearer /);
});
for (const method of ['quote', 'accept']) test(`real ${method} snapshots all JSON before awaiting renewal`, async () => {
  const deferred = pending(), input = method === 'quote' ? selection() : dto();
  const expectedBody = method === 'quote' ? plain(input) : { expectedQuote: plain(input) };
  const f = runtime(call => call.url.endsWith('/access') ? deferred.promise : Response.json(method === 'quote' ? dto() : ack()), true);
  f.load('lib/conversation-access.ts').rememberConversationAccess('conversation-a', token(true));
  const work = f.load('lib/api/api-client.ts').crossSellApi[method]('merchant-a', 'conversation-a', 'conversation-a', input);
  input.variantId = 'mutated'; input.promotionId = 'mutated'; input.quantity = 99;
  if (method === 'accept') input.cartBasis.items[0].quantity = 99;
  assert.equal(f.calls.length, 1);
  deferred.resolve(Response.json({ conversation_id: 'conversation-a', merchant_id: 'merchant-a', conversation_token: token() }));
  await work; assert.equal(f.calls.length, 2); assert.deepEqual(JSON.parse(f.calls[1].body), expectedBody);
});
for (const method of ['quote', 'accept']) test(`real ${method} network error propagates without retry, chat or local cart`, async () => {
  const f = runtime(() => { throw new Error('synthetic_network_lost'); }, true);
  f.load('lib/conversation-access.ts').rememberConversationAccess('conversation-a', token());
  await assert.rejects(f.load('lib/api/api-client.ts').crossSellApi[method]('merchant-a', 'conversation-a', 'conversation-a', method === 'quote' ? selection() : dto()), /synthetic_network_lost/);
  assert.equal(f.calls.length, 1);
});
for (const [status, code] of [[422, 'cross_sell_quote_review_required'], [409, 'storefront_cart_snapshot_conflict']]) {
  test(`real acceptance error preserves exact status ${status} and body.code without classification by text`, async () => {
    const f = runtime(() => Response.json({ code, message: 'Synthetic server prose is not a UI contract.' }, { status }), true);
    f.load('lib/conversation-access.ts').rememberConversationAccess('conversation-a', token());
    await assert.rejects(f.load('lib/api/api-client.ts').crossSellApi.accept('merchant-a', 'conversation-a', 'conversation-a', dto()), error => {
      assert.equal(error.status, status); assert.equal(error.body.code, code); return true;
    });
    assert.equal(f.calls.length, 1);
  });
}
test('bounded JSON corpus agrees with the ACTUAL backend Zod quote/request/ack schemas in an isolated child', t => {
  const corpus = [{ kind: 'quote', name: 'canonical B/P/D', value: dto() }];
  for (const [name, mutate] of [...quoteMutations, ...intentNoticeMutations]) {
    // undefined own keys cannot survive JSON transport. Their stricter local
    // behavior is covered above; do not claim differential JSON proof for them.
    if (name.startsWith('undefined')) continue;
    const value = dto(); mutate(value); corpus.push({ kind: 'quote', name, value });
  }
  for (const instant of ['2026-10-18T12:00Z', '2026-10-18T12:00+03:00', '0000-02-29T12:00:00Z']) {
    const value = dto(); value.promotionUpdatedAt = instant; corpus.push({ kind: 'quote', name: instant, value });
  }
  const withIntent = dto();
  withIntent.cartBasis.items[0].crossSellIntent = { version: 1, promotionId: 'prior', promotionUpdatedAt: withIntent.promotionUpdatedAt, acceptedQuantity: 2, originalUnitPriceCents: 5000, maximumUnitPriceCents: 5000 };
  withIntent.cartBasis.items[0].selectedOptions = [];
  withIntent.quote.commercialNotices = [{ version: 1, code: 'discount_limit_reached', message: 'Bounded server notice.' }];
  corpus.push({ kind: 'quote', name: 'existing intent and notice', value: withIntent });
  const zero = dto(); zero.originalUnitPriceCents = zero.maximumUnitPriceCents = zero.cartBasis.total = 0;
  zero.cartBasis.items[0].unitPriceCents = 0;
  for (const line of zero.quote.items) line.baseUnitPriceCents = line.unitPriceCents = 0;
  zero.quote.originalSubtotalCents = zero.quote.promotionDiscountCents = zero.quote.subtotalCents = zero.quote.merchandiseTotalCents = 0;
  corpus.push({ kind: 'quote', name: 'zero exact money', value: zero });
  for (const basisSize of [199, 200]) {
    const value = dto(); value.originalUnitPriceCents = value.maximumUnitPriceCents = 1;
    value.cartBasis.items = Array.from({ length: basisSize }, (_, i) => ({ variantId: `v-${i}`, productId: `p-${i}`, sku: `s-${i}`, name: 'Bounded', quantity: 1, unitPriceCents: 1 }));
    value.cartBasis.total = basisSize;
    value.quote.items = [...value.cartBasis.items.map(item => ({ variantId: item.variantId, productId: item.productId, quantity: 1, baseUnitPriceCents: 1, unitPriceCents: 1 })),
      { variantId: value.variantId, productId: value.productId, quantity: 1, baseUnitPriceCents: 1, unitPriceCents: 1 }];
    value.quote.originalSubtotalCents = value.quote.subtotalCents = value.quote.merchandiseTotalCents = basisSize + 1; value.quote.promotionDiscountCents = 0;
    corpus.push({ kind: 'quote', name: `cart basis ${basisSize}`, value });
  }
  for (const quantity of [0, 1, 99, 100, 1.1, '1']) corpus.push({ kind: 'request', name: `quantity ${quantity}`, value: { ...selection(), quantity } });
  corpus.push({ kind: 'request', name: 'unknown price', value: { ...selection(), price: 1 } });
  for (const value of [ack(), { ...ack(), version: 2 }, { ...ack(), status: 'pending' }, { ...ack(), privateCost: 1 }]) corpus.push({ kind: 'ack', name: JSON.stringify(value), value });
  assert.ok(corpus.length < 80);
  const payload = JSON.stringify(corpus); assert.ok(Buffer.byteLength(payload) < 128 * 1024);
  const apiDirectory = path.resolve(__dirname, '../../api');
  const childEnvironment = { NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1' };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) {
    if (process.env[name] !== undefined) childEnvironment[name] = process.env[name];
  }
  // Only pure domain schemas are imported. No AppModule, dotenv, Prisma, pool,
  // service, provider or inherited NODE_OPTIONS/credentials enter this child.
  const script = `
    import { crossSellStorefrontQuoteSchema, crossSellStorefrontQuoteRequestSchema, crossSellStorefrontAcknowledgementSchema }
      from './src/modules/cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.ts';
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 131072) throw new Error('quote_corpus_too_large'); }
    const corpus = JSON.parse(input); if (!Array.isArray(corpus) || corpus.length >= 80) throw new Error('quote_corpus_unbounded');
    const schemas = { quote: crossSellStorefrontQuoteSchema, request: crossSellStorefrontQuoteRequestSchema, ack: crossSellStorefrontAcknowledgementSchema };
    process.stdout.write(JSON.stringify(corpus.map(item => {
      if (!Object.hasOwn(schemas, item.kind)) throw new Error('unknown_quote_corpus_kind');
      const result = schemas[item.kind].safeParse(item.value);
      return result.success ? { success: true, data: result.data } : { success: false };
    })));
  `;
  const child = spawnSync(process.execPath, ['--import', './tests/test-network-guard.mjs', '--loader', './tests/ready-prod-loader.mjs', '--input-type=module', '-e', script], {
    cwd: apiDirectory, env: childEnvironment, input: payload, encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 512 * 1024,
  });
  assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); assert.equal(child.signal, null);
  const backend = JSON.parse(child.stdout); assert.equal(backend.length, corpus.length);
  assert.ok(backend.filter(result => result.success).length >= 10); assert.ok(backend.filter(result => !result.success).length >= 20);
  t.diagnostic(`Actual backend Zod corpus: ${corpus.length} cases, ${backend.filter(result => result.success).length} valid, ${backend.filter(result => !result.success).length} invalid.`);
  const parser = runtime().load('lib/cross-sell-quote.ts');
  const wireCorpus = JSON.parse(payload);
  for (let i = 0; i < wireCorpus.length; i++) {
    const item = wireCorpus[i]; let frontend;
    try {
      const data = item.kind === 'quote' ? parser.parseCrossSellQuote(item.value)
        : item.kind === 'request' ? parser.parseCrossSellSelection(item.value)
        : parser.parseCrossSellAcceptance(item.value, item.value.merchantId, item.value.cartId);
      frontend = { success: true, data: plain(data) };
    } catch { frontend = { success: false }; }
    assert.deepEqual(frontend, backend[i], `manual browser / actual backend drift: ${item.kind}/${item.name}`);
  }
});
// Confirmation orchestration is deliberately NOT connected to the UI. These
// transport seams alone do not prove a buyer gesture, stale-state protection or
// public activation; the approved existing component needs its own contract.
