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
const plain = value => JSON.parse(JSON.stringify(value));
const scope={merchantId:'store',cartId:'cart',conversationId:'cart'};
const product=()=>({id:'b',productId:'product-b',name:'Complemento',price:20,priceFormatted:'R$ 20,00',inStock:true,promoId:'promo'});
const quote=()=>({version:1,merchantId:'store',cartId:'cart',variantId:'b',productId:'product-b',sku:'B',promotionId:'promo',promotionUpdatedAt:'2026-11-01T00:00:00.000Z',quantity:1,
  originalUnitPriceCents:2000,maximumUnitPriceCents:1800,cartBasis:{items:[{variantId:'a',productId:'product-a',sku:'A',name:'Base',quantity:1,unitPriceCents:4000}],total:4000,discount:0,couponCode:null,freeShipping:false},
  quote:{currency:'BRL',originalSubtotalCents:6000,promotionDiscountCents:200,subtotalCents:5800,merchandiseTotalCents:5800,items:[{variantId:'a',productId:'product-a',quantity:1,baseUnitPriceCents:4000,unitPriceCents:4000},{variantId:'b',productId:'product-b',quantity:1,baseUnitPriceCents:2000,unitPriceCents:1800}]}});
const cart=()=>({cartId:'cart',items:[{variantId:'a',productName:'Base',quantity:1,price:40,subtotal:40,optionItemIds:[]},{variantId:'b',productName:'Complemento',quantity:1,price:18,subtotal:18,optionItemIds:[]}],itemCount:2,subtotal:58,total:58,discount:0,freeShipping:false});
function fixture(afterAccepted){const calls=[],applied=[];const transport={async quote(){calls.push('quote');return quote();},async accept(){calls.push('accept');return{version:1,status:'accepted',merchantId:'store',cartId:'cart'};},async getCart(){calls.push('get');return cart();},applyCart(value){applied.push(plain(value));calls.push('apply');},...(afterAccepted?{afterAccepted}: {})};
  const{StorefrontCrossSellBuyerFlow}=load('storefront-cross-sell-flow.ts');return{flow:new StorefrontCrossSellBuyerFlow(scope,transport,()=>true),calls,applied,transport};}
test('S3 optional follow-up starts only after ACK, matching canonical GET and applied cart',async()=>{
  let captured;const f=fixture((...args)=>{f.calls.push('follow-up');captured=args;});await f.flow.prepare([product()]);const shown=f.flow.present([product()])[0];
  assert.equal(await f.flow.accept(shown),true);assert.deepEqual(f.calls,['quote','accept','get','apply','follow-up']);assert.deepEqual(plain(captured),[scope,quote(),cart()]);assert.equal(f.applied.length,1);
});
test('S3 slow follow-up never delays recognized acceptance and read failure never retries the writer',async()=>{
  let reject;const f=fixture(()=>new Promise((_,fail)=>{reject=fail;}));await f.flow.prepare([product()]);const shown=f.flow.present([product()])[0];
  assert.equal(await f.flow.accept(shown),true);assert.equal(typeof reject,'function');assert.equal(f.flow.present([product()])[0].acceptanceStatus,'accepted');
  reject(Error('read unavailable'));await Promise.resolve();await Promise.resolve();assert.equal(f.flow.present([product()])[0].acceptanceStatus,'accepted');assert.equal(await f.flow.accept(shown),false);assert.equal(f.calls.filter(value=>value==='accept').length,1);assert.equal(f.applied.length,1);
});
test('S3 failed ACK and mismatched canonical cart cannot run a post-accept read',async()=>{
  for(const fault of ['ack','cart']){let follows=0;const f=fixture(()=>{follows++;});if(fault==='ack')f.transport.accept=async()=>{throw Error('no ack');};else f.transport.getCart=async()=>({...cart(),cartId:'foreign'});
    await f.flow.prepare([product()]);assert.equal(await f.flow.accept(f.flow.present([product()])[0]),false);assert.equal(follows,0);assert.deepEqual(f.applied,[]);}
});
test('S3 omitted hook preserves the original quote/accept/get/apply path',async()=>{const f=fixture();await f.flow.prepare([product()]);assert.equal(await f.flow.accept(f.flow.present([product()])[0]),true);assert.deepEqual(f.calls,['quote','accept','get','apply']);});
test('S3 synchronous applied-cart revision guards the new read without the old Flow key',()=>{
  const{createPostAcceptReadGuard}=load('post-cart-suggestions.ts');let current={key:'new-cart',revision:2},mounted=true;
  const alive=createPostAcceptReadGuard(current,()=>current,()=>mounted);assert.equal(alive(),true);current={key:'changed',revision:3};assert.equal(alive(),false);current={key:'new-cart',revision:4};assert.equal(alive(),false);mounted=false;assert.equal(alive(),false);
});
test('S3 captured scope is immutable and logout invalidates a pending recommendation read',()=>{
  const{createPostAcceptReadGuard}=load('post-cart-suggestions.ts');const captured={key:'accepted',revision:4};let current={...captured};const alive=createPostAcceptReadGuard(captured,()=>current,()=>true);
  captured.key='forged';captured.revision=99;assert.equal(alive(),true);current={key:'logged-out',revision:5};assert.equal(alive(),false);
});
const suggestion=()=>({type:'cross_sell',data:{trigger:'Complementos publicados',displayMode:'interstitial',products:[{id:'c',productId:'product-c',name:'Novo complemento',price:10,priceFormatted:'R$ 10,00',inStock:true,promoId:'next'}]}});
test('S3 optional response requires the same actual cart and accepted member',()=>{
  const{parsePostAddCartResponse}=load('post-cart-suggestions.ts');const value={...cart(),postCartSuggestions:suggestion()};assert.deepEqual(plain(parsePostAddCartResponse(value,scope,'b').postCartSuggestions),suggestion());
  for(const bad of [{...value,cartId:'foreign'},{...value,items:cart().items.slice(0,1)},{...value,postCartSuggestions:{type:'cart_summary',data:{}}}])assert.throws(()=>parsePostAddCartResponse(bad,scope,'b'));
});
test('S3 malformed offer/out-of-stock/foreign instruction fields cannot become a new recommendation',()=>{
  const{parsePostAddCartResponse}=load('post-cart-suggestions.ts');for(const bad of [{...suggestion(),data:{...suggestion().data,products:[{...suggestion().data.products[0],inStock:false}]}},
    {...suggestion(),data:{...suggestion().data,products:[{...suggestion().data.products[0],paid:true}]}},null])assert.throws(()=>parsePostAddCartResponse({...cart(),postCartSuggestions:bad},scope,'b'));
});