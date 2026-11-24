import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../../storefront/src/lib/',import.meta.url));
function load(relative, cache = new Map()) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = id => id.startsWith(".") ? load(id.replace(/\.js$/, "") + ".ts", cache) : require(id);
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { console, URL, Date, BigInt, Intl, structuredClone })(localRequire, module, module.exports);
  return module.exports;
}
test('S3 same-cart logout and buyer A/B/A epoch changes invalidate the detached read',()=>{
  const {createPostAcceptReadGuard}=load('post-cart-suggestions.ts');const cart={key:'unchanged-cart',revision:4};
  let identity={buyerId:'buyer-a',revision:2};const captured={...identity};
  const alive=createPostAcceptReadGuard(cart,()=>cart,()=>true,{captured,current:()=>identity});
  assert.equal(alive(),true);identity={buyerId:null,revision:3};assert.equal(alive(),false);
  identity={buyerId:'buyer-b',revision:4};assert.equal(alive(),false);identity={buyerId:'buyer-a',revision:5};assert.equal(alive(),false);
  captured.buyerId='mutated';captured.revision=99;identity={buyerId:'buyer-a',revision:2};assert.equal(alive(),true);
});
test('S3 expired or changed buyer invalidates a read even without a storage event',()=>{
  const {createPostAcceptReadGuard}=load('post-cart-suggestions.ts');const cart={key:'unchanged-cart',revision:4};
  let identity={buyerId:'buyer-a',revision:2};const alive=createPostAcceptReadGuard(cart,()=>cart,()=>true,{captured:{...identity},current:()=>identity});
  identity={buyerId:null,revision:2};assert.equal(alive(),false);identity={buyerId:'buyer-b',revision:2};assert.equal(alive(),false);
  assert.equal(createPostAcceptReadGuard(cart,()=>cart,()=>true)(),true);
});