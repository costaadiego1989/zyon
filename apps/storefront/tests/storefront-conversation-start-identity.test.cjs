const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const root = path.resolve(__dirname, "../src"), plain = value => JSON.parse(JSON.stringify(value));
const capability = { version: 1, tools: ["search_products", "get_product_details"] };
const token = `${Buffer.from(JSON.stringify({ origin: "https://store.fixture.invalid", expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.synthetic-not-signed`;
const response = (extra = {}) => ({ conversation_id: "conversation-a", conversation_token: token, ui_action_capability: capability, ...extra });
const deferred = () => { let resolve; const promise = new Promise(finish => { resolve = finish; }); return { promise, resolve }; };
function runtime(fetchResponse) {
  const modules = new Map(), calls = [], writes = [], storage = new Map();
  const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem(key, value) { writes.push(["set", key, value]); storage.set(key, value); }, removeItem(key) { writes.push(["remove", key]); storage.delete(key); } };
  const context = vm.createContext({ console, URL, URLSearchParams, Headers, Request, Response, AbortSignal, Date, atob, setTimeout, clearTimeout,
    process: { env: { NEXT_PUBLIC_API_BASE_URL: "https://api.fixture.invalid" } }, window: { location: { origin: "https://store.fixture.invalid" } },
    sessionStorage, localStorage: sessionStorage,
    fetch: async (url, options) => { const call = { url: String(url), ...options }; calls.push(call); return fetchResponse(call, calls.length); } });
  function load(relative) {
    const file = path.isAbsolute(relative) ? relative : path.join(root, relative); if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename: file })(id => {
      if (id.startsWith("@/") || id.startsWith(".")) { const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id);
        const target = [base, base + ".ts", path.join(base, "index.ts")].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!target) throw Error("unexpected_identity_dependency:" + id); return load(target); }
      throw Error("unexpected_external_identity_dependency:" + id);
    }, module, module.exports); return module.exports;
  }
  return { load, calls, writes, storage, client: () => load("lib/api/api-client.ts").checkoutApi,
    access: () => load("lib/conversation-access.ts"), read: () => load("lib/storefront-read-ui-action.ts") };
}
test("matching explicit merchant binds the returned access and read capability only after identity validation", async () => {
  const body = response({ merchant_id: "merchant-a" }), f = runtime(async () => Response.json(body));
  assert.deepEqual(plain(await f.client().create({ merchantId: "merchant-a" })), body);
  assert.equal(f.access().conversationAccessHeaders("conversation-a").Authorization, `Bearer ${token}`);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, "/api/storefront-conversations");
  assert.deepEqual(JSON.parse(f.calls[0].body), { merchant_id: "merchant-a" });
  assert.ok(f.writes.some(([operation]) => operation === "set"));
  assert.deepEqual(plain(f.read().storefrontReadUiActionRequest("conversation-a", "merchant-a", { tool: "get_product_details", args: { productId: "p" } })),
    { ui_action_version: 1, ui_action: { tool: "get_product_details", args: { productId: "p" } } });
});
test("absent merchant_id retains legacy access behavior without advertising a tenant-bound read capability", async () => {
  const body = response(), f = runtime(async () => Response.json(body));
  assert.deepEqual(plain(await f.client().create({ merchantId: "merchant-a" })), body);
  assert.equal(f.access().conversationAccessHeaders("conversation-a").Authorization, `Bearer ${token}`);
  assert.equal(f.read().storefrontReadUiActionRequest("conversation-a", "merchant-a", { tool: "get_product_details", args: { productId: "p" } }), undefined);
});
for (const merchant_id of ["merchant-b", "", " merchant-a ", null, 7, false]) test(`explicit mismatched tenant ${JSON.stringify(merchant_id)} rejects before every credential/capability write`, async () => {
  const f = runtime(async () => Response.json(response({ merchant_id })));
  await assert.rejects(f.client().create({ merchantId: "merchant-a" }), /conversation_start_merchant_mismatch/);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.writes, []); assert.equal(f.storage.size, 0);
  assert.deepEqual(plain(f.access().conversationAccessHeaders("conversation-a")), {});
  assert.equal(f.read().storefrontReadUiActionRequest("conversation-a", "merchant-a", { tool: "get_product_details", args: { productId: "p" } }), undefined);
});
test("parallel matching starts share a single request and retain the same validated response", async () => {
  const gate = deferred(), f = runtime(async () => { await gate.promise; return Response.json(response({ merchant_id: "merchant-a" })); });
  const first = f.client().create({ merchantId: "merchant-a" }), second = f.client().create({ merchantId: "merchant-a" });
  assert.equal(f.calls.length, 1); gate.resolve(); const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b); assert.equal(f.calls.length, 1);
});
test("tenant response binding uses the requested snapshot even when caller mutates its input during fetch", async () => {
  const gate = deferred(), f = runtime(async () => { await gate.promise; return Response.json(response({ merchant_id: "merchant-b" })); });
  const input = { merchantId: "merchant-a" }, work = f.client().create(input); const rejection = assert.rejects(work, /conversation_start_merchant_mismatch/);
  input.merchantId = "merchant-b"; gate.resolve(); await rejection;
  assert.deepEqual(JSON.parse(f.calls[0].body), { merchant_id: "merchant-a" }); assert.deepEqual(f.writes, []);
});
test("parallel mismatched starts share rejection, write nothing, and release singleflight for a later explicit start", async () => {
  const gate = deferred(), f = runtime(async (_, count) => { if (count === 1) { await gate.promise; return Response.json(response({ merchant_id: "merchant-b" })); } return Response.json(response({ merchant_id: "merchant-a" })); });
  const first = f.client().create({ merchantId: "merchant-a" }), second = f.client().create({ merchantId: "merchant-a" });
  const pending = Promise.allSettled([first, second]); assert.equal(f.calls.length, 1); gate.resolve();
  const settled = await pending; assert.deepEqual(settled.map(result => result.status), ["rejected", "rejected"]); assert.deepEqual(f.writes, []);
  await f.client().create({ merchantId: "merchant-a" }); assert.equal(f.calls.length, 2);
  assert.equal(f.access().conversationAccessHeaders("conversation-a").Authorization, `Bearer ${token}`);
});
