import assert from 'node:assert/strict';
import test from 'node:test';
import {readPostAddCartSuggestions} from '../src/modules/storefront/application/services/read-post-add-cart-suggestions.js';
const input=()=>({merchantId:'store',cartId:'cart',variantId:'b',cart:{merchantId:'store',sessionId:'cart',items:[{variantId:'b',quantity:1}]}});
const block=()=>({type:'cross_sell',data:{trigger:'Complementos publicados',displayMode:'interstitial',products:[{id:'c',productId:'product-c',name:'Complemento atual',price:10,priceFormatted:'R$ 10,00',inStock:true,promoId:'rule'}]}});
test('S3 post-add reader calls only the existing same-cart canonical read with a present accepted member',async()=>{const calls:any[]=[];
  const result=await readPostAddCartSuggestions(input(),{postCartSuggestions:async scope=>{calls.push(scope);return block() as any;}});assert.deepEqual(result,block());assert.deepEqual(calls,[{merchantId:'store',cartId:'cart',addedVariantId:'b'}]);});
test('S3 post-add reader refuses foreign cart/tenant/missing member before a recommendation read',async()=>{
  for(const altered of [{...input(),cartId:'foreign'},{...input(),merchantId:'foreign'},{...input(),variantId:'missing'}, {...input(),variantId:' b '},{...input(),cart:{...input().cart,items:[{variantId:'b',quantity:0}]}}]){
    let reads=0;await assert.rejects(readPostAddCartSuggestions(altered,{postCartSuggestions:async()=>{reads++;return block() as any;}}),/post_add_context_invalid/);assert.equal(reads,0);
  }
});
test('S3 read outage or malformed block cannot change an acknowledged cart into an acceptance error',async()=>{
  for(const mode of ['throw','malformed','absent']){const before=input(),snapshot=structuredClone(before);
    const result=await readPostAddCartSuggestions(before,{postCartSuggestions:async()=>{if(mode==='throw')throw Error('reader unavailable');return mode==='absent'?undefined:{type:'cart_summary',data:{}} as any;}});
    assert.equal(result,undefined);assert.deepEqual(before,snapshot);
  }
});
test('S3 post-add reader snapshots the accepted context before its first await',async()=>{
  const original=input(),calls:any[]=[];const result=await readPostAddCartSuggestions(original,{postCartSuggestions:async scope=>{calls.push(structuredClone(scope));original.merchantId='changed';original.variantId='changed';return block() as any;}});
  assert.deepEqual(result,block());assert.deepEqual(calls,[{merchantId:'store',cartId:'cart',addedVariantId:'b'}]);
});