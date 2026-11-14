const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');
const scope = { merchantId: 'synthetic-merchant', cartRef: 'synthetic-cart' };
const response = token => Response.json({ embed_session_token: token, expires_at_unix: 2000000000 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function runtime(options = {}) {
  const calls = [], storage = options.storage ?? new Map(), window = options.ssr ? undefined : { location: { origin: 'https://store.fixture.invalid' } };
  const context = vm.createContext({ Promise, Map, URL, JSON, Error, Number, Object, String, window,
    sessionStorage: { getItem(key) { if (options.brokenStorage) throw Error('private'); return storage.get(key) ?? null; },
      setItem(key, value) { if (options.brokenStorage) throw Error('private'); storage.set(key, value); }, removeItem(key) { storage.delete(key); } } });
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/checkout-session-access.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(`(function(require,module,exports){${source}\n})`, context)(id => {
    if (id === './conversation-access') return { conversationFetch: async (cart, url, init) => {
      const call = { cart, url, ...init, body: JSON.parse(init.body) }; calls.push(call);
      return options.fetch ? options.fetch(call, calls) : response(`synthetic-token-${calls.length}`);
    } };
    if (id === './buyer-auth') return { getValidBuyer: () => options.buyer ?? null };
    throw Error('unexpected dependency: ' + id);
  }, module, module.exports);
  return { ...module.exports, calls, storage, window };
}
const unavailable = error => error?.message === 'checkout_session_unavailable';

test('first start uses existing endpoint/current buyer proof and only a tab-scoped token record', async () => {
  const f = runtime({ buyer: { token: 'synthetic-buyer-proof', globalUserId: 'synthetic-buyer' } });
  assert.equal(await f.requestStorefrontCheckoutToken(scope), 'synthetic-token-1');
  assert.equal(f.calls.length, 1); const call = f.calls[0];
  assert.equal(call.cart, scope.cartRef); assert.equal(call.url, '/api/checkout-token'); assert.equal(call.method, 'POST');
  assert.deepEqual(call.body, { merchant_id: scope.merchantId, cart_ref: scope.cartRef,
    allowed_origin: f.window.location.origin, buyer_access_token: 'synthetic-buyer-proof' });
  assert.equal(f.storage.size, 1); const stored = [...f.storage.values()][0];
  assert.deepEqual(JSON.parse(stored), { version: 1, token: 'synthetic-token-1' });
  assert.equal(stored.includes('buyer'), false);
});

test('reopen always validates previous proof on server instead of fresh issuance', async () => {
  const f = runtime(); await f.requestStorefrontCheckoutToken(scope); await f.requestStorefrontCheckoutToken(scope);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body.previous_embed_token, 'synthetic-token-1');
});

test('new module realm in same tab restores proof but still asks server to continue', async () => {
  const first = runtime(); await first.requestStorefrontCheckoutToken(scope);
  const second = runtime({ storage: first.storage }); await second.requestStorefrontCheckoutToken(scope);
  assert.equal(second.calls[0].body.previous_embed_token, 'synthetic-token-1');
});

test('20 simultaneous opens share exactly one POST and one token receipt', async () => {
  const barrier = deferred(), f = runtime({ fetch: () => barrier.promise });
  const pending = Array.from({ length: 20 }, () => f.requestStorefrontCheckoutToken(scope));
  assert.equal(f.calls.length, 1); barrier.resolve(response('synthetic-shared'));
  assert.deepEqual(await Promise.all(pending), Array(20).fill('synthetic-shared'));
});

for (const status of [401, 403, 409, 429, 500]) test(`failed continuation ${status} retains proof without automatic replay or fresh fallback`, async () => {
  const f = runtime({ fetch: (_call, calls) => calls.length === 1 ? response('synthetic-prior') : Response.json({}, { status }) });
  await f.requestStorefrontCheckoutToken(scope); await assert.rejects(f.requestStorefrontCheckoutToken(scope), unavailable);
  assert.equal(f.calls.length, 2); await assert.rejects(f.requestStorefrontCheckoutToken(scope), unavailable);
  assert.equal(f.calls.length, 3); assert.equal(f.calls[2].body.previous_embed_token, 'synthetic-prior');
});

test('network failure never erases previous proof or exposes the transport cause', async () => {
  const f = runtime({ fetch: (_call, calls) => { if (calls.length === 1) return response('synthetic-prior'); throw Error('PRIVATE_CANARY'); } });
  await f.requestStorefrontCheckoutToken(scope); await assert.rejects(f.requestStorefrontCheckoutToken(scope), unavailable);
  assert.equal([...f.storage.values()][0].includes('synthetic-prior'), true); assert.equal(f.calls.length, 2);
});

for (const data of [null, {}, { embed_session_token: '', expires_at_unix: 2000000000 },
  { embed_session_token: 'x'.repeat(8193), expires_at_unix: 2000000000 },
  { embed_session_token: 'synthetic', expires_at_unix: '2000000000' }, { embed_session_token: 'synthetic', expires_at_unix: 1.5 }]) {
  test(`malformed reply ${JSON.stringify(data)?.slice(0, 60)} cannot replace prior proof`, async () => {
    const f = runtime({ fetch: (_call, calls) => calls.length === 1 ? response('synthetic-prior') : Response.json(data) });
    await f.requestStorefrontCheckoutToken(scope); await assert.rejects(f.requestStorefrontCheckoutToken(scope), unavailable);
    assert.equal([...f.storage.values()][0].includes('synthetic-prior'), true); assert.equal(f.calls.length, 2);
  });
}

for (const patch of [{ merchantId: 'other' }, { cartRef: 'other' }]) test(`distinct context ${JSON.stringify(patch)} never borrows another proof`, async () => {
  const f = runtime(); await f.requestStorefrontCheckoutToken(scope); await f.requestStorefrontCheckoutToken({ ...scope, ...patch });
  assert.equal(f.calls[1].body.previous_embed_token, undefined);
});

test('origin change never borrows an earlier origin proof', async () => {
  const f = runtime(); await f.requestStorefrontCheckoutToken(scope); f.window.location.origin = 'https://other.fixture.invalid';
  await f.requestStorefrontCheckoutToken(scope); assert.equal(f.calls[1].body.previous_embed_token, undefined);
});

test('storage denial uses memory to preserve same-page remount continuity', async () => {
  const f = runtime({ brokenStorage: true }); await f.requestStorefrontCheckoutToken(scope); await f.requestStorefrontCheckoutToken(scope);
  assert.equal(f.calls[1].body.previous_embed_token, 'synthetic-token-1');
});

for (const corrupt of ['not-json', '{"version":2,"token":"synthetic"}', '{"version":1,"token":null}']) test(`corrupt persisted context ${corrupt} fails before any fresh issue`, async () => {
  const f = runtime(); await f.requestStorefrontCheckoutToken(scope); f.storage.set([...f.storage.keys()][0], corrupt);
  const fresh = runtime({ storage: f.storage }); await assert.rejects(fresh.requestStorefrontCheckoutToken(scope), unavailable);
  assert.equal(fresh.calls.length, 0);
});

test('explicit clear forgets only the exact cart and starts a new local context', async () => {
  const f = runtime(); await f.requestStorefrontCheckoutToken(scope); await f.requestStorefrontCheckoutToken({ ...scope, cartRef: 'other' });
  f.forgetStorefrontCheckoutToken(scope); await f.requestStorefrontCheckoutToken(scope);
  assert.equal(f.calls[2].body.previous_embed_token, undefined); await f.requestStorefrontCheckoutToken({ ...scope, cartRef: 'other' });
  assert.equal(f.calls[3].body.previous_embed_token, 'synthetic-token-2');
});

test('late receipt after cart clear cannot resurrect old proof or delete a newer request', async () => {
  const barrier = deferred(), f = runtime({ fetch: (_call, calls) => calls.length === 1 ? barrier.promise : response('synthetic-new') });
  const old = f.requestStorefrontCheckoutToken(scope); f.forgetStorefrontCheckoutToken(scope);
  const newer = f.requestStorefrontCheckoutToken(scope); assert.equal(await newer, 'synthetic-new');
  barrier.resolve(response('synthetic-old')); await assert.rejects(old, unavailable);
  assert.equal([...f.storage.values()][0].includes('synthetic-new'), true);
});

test('explicit refresh without cached context preserves its previous proof even on failure', async () => {
  const f = runtime({ fetch: () => Response.json({}, { status: 403 }) });
  await assert.rejects(f.requestStorefrontCheckoutToken({ ...scope, previousToken: 'synthetic-explicit' }), unavailable);
  await assert.rejects(f.requestStorefrontCheckoutToken(scope), unavailable);
  assert.equal(f.calls[1].body.previous_embed_token, 'synthetic-explicit');
});

test('stale explicit refresh cannot silently replace the cached session', async () => {
  const f = runtime(); await f.requestStorefrontCheckoutToken(scope);
  await assert.rejects(f.requestStorefrontCheckoutToken({ ...scope, previousToken: 'different' }), unavailable);
  assert.equal(f.calls.length, 1);
});

for (const invalid of [{ merchantId: '', cartRef: 'cart' }, { ...scope, cartRef: ' ' }, { ...scope, previousToken: '' }]) test(`invalid client scope ${JSON.stringify(invalid)} cannot send`, async () => {
  const f = runtime(); await assert.rejects(f.requestStorefrontCheckoutToken(invalid), unavailable); assert.equal(f.calls.length, 0);
});

test('server rendering cannot use or create shared credential state', async () => {
  const f = runtime({ ssr: true }); await assert.rejects(f.requestStorefrontCheckoutToken(scope), unavailable); assert.equal(f.calls.length, 0);
});
