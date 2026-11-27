/** @vitest-environment jsdom */
import React, {act, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, expect, it, vi} from 'vitest';
import {useStorefrontCrossSell} from './use-storefront-cross-sell';
import {getValidBuyer} from './buyer-auth';
import type {CartState} from './cart-store';
import type {CrossSellDisplayProduct} from './storefront-cross-sell-flow';

// Only component transport responses are controlled. The actual hook, Flow,
// storage event listener and buyer getter execute. These unsigned UI identity
// hints never leave this test and are not JWT/authentication or HTTP proof.
const ports=vi.hoisted(()=>({quote:vi.fn(),accept:vi.fn(),get:vi.fn(),post:vi.fn()}));
vi.mock('./api/api-client',()=>({crossSellApi:{quote:ports.quote,accept:ports.accept},cartApi:{get:ports.get,getPostAddSuggestions:ports.post}}));
const scope={merchantId:'store',conversationId:'cart'};
const product:CrossSellDisplayProduct={id:'b',productId:'product-b',name:'Complemento',price:20,priceFormatted:'R$ 20,00',inStock:true,promoId:'promo'};
const products=[product];
const before=():CartState=>({cartId:'cart',items:[{variantId:'a',productName:'Base',quantity:1,price:40,subtotal:40,optionItemIds:[]}],itemCount:1,total:40,discount:0,freeShipping:false});
const after=()=>({cartId:'cart',items:[...before().items,{variantId:'b',productName:'Complemento',quantity:1,price:18,subtotal:18,optionItemIds:[]}],itemCount:2,subtotal:58,total:58,discount:0,freeShipping:false});
const quote=()=>({version:1,merchantId:'store',cartId:'cart',variantId:'b',productId:'product-b',sku:'B',promotionId:'promo',promotionUpdatedAt:'2026-11-01T00:00:00.000Z',quantity:1,
  originalUnitPriceCents:2000,maximumUnitPriceCents:1800,cartBasis:{items:[{variantId:'a',productId:'product-a',sku:'A',name:'Base',quantity:1,unitPriceCents:4000}],total:4000,discount:0,couponCode:null,freeShipping:false},
  quote:{currency:'BRL',originalSubtotalCents:6000,promotionDiscountCents:200,subtotalCents:5800,merchandiseTotalCents:5800,items:[{variantId:'a',productId:'product-a',quantity:1,baseUnitPriceCents:4000,unitPriceCents:4000},{variantId:'b',productId:'product-b',quantity:1,baseUnitPriceCents:2000,unitPriceCents:1800}]}});
const block=()=>({type:'cross_sell' as const,data:{trigger:'Complementos publicados',displayMode:'interstitial' as const,products:[{id:'c',productId:'product-c',name:'Próximo complemento',price:10,priceFormatted:'R$ 10,00',inStock:true,promoId:'next'}]}});
const read=()=>({...after(),postCartSuggestions:block()});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
function identity(id:string|null,expires=Math.floor(Date.now()/1000)+3600){
  if(id===null)localStorage.removeItem('zyon_buyer_token');
  else localStorage.setItem('zyon_buyer_token','ui-only.'+btoa(JSON.stringify({sub:id,exp:expires}))+'.not-an-api-signature');
  window.dispatchEvent(new StorageEvent('storage',{key:'zyon_buyer_token',newValue:localStorage.getItem('zyon_buyer_token')}));
}
const mounts:Array<{root:Root;host:HTMLDivElement}>=[];
afterEach(async()=>{for(const item of mounts.splice(0)){await act(async()=>item.root.unmount());item.host.remove();}localStorage.clear();vi.restoreAllMocks();for(const port of Object.values(ports))port.mockReset();});
async function fixture(boundary:'ACK'|'GET'|'READ'|'none'){
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});identity('buyer-a');
  const reached=deferred<void>(),release=deferred<void>(),applied:unknown[]=[],published:unknown[]=[];let pending:Promise<boolean>|undefined,latestKey='';
  ports.quote.mockImplementation(async()=>quote());
  ports.accept.mockImplementation(async()=>{if(boundary==='ACK'){reached.resolve();await release.promise;}return{version:1,status:'accepted',merchantId:'store',cartId:'cart'};});
  ports.get.mockImplementation(async()=>{if(boundary==='GET'){reached.resolve();await release.promise;}return after();});
  ports.post.mockImplementation(async()=>{if(boundary==='READ'){reached.resolve();await release.promise;}return read();});
  function Buyer(){const[cart,setCart]=useState(before);const flow=useStorefrontCrossSell({...scope,cart},[products],snapshot=>{applied.push(structuredClone(snapshot));setCart(snapshot as unknown as CartState);},value=>published.push(structuredClone(value)));
    latestKey=flow.scopeKey;const shown=flow.quoted(products)[0];return <button disabled={!shown} onClick={()=>{pending=flow.accept(shown);}}>Adicionar complemento</button>;}
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounts.push({root,host});
  await act(async()=>{root.render(<Buyer/>);});await act(async()=>{await Promise.resolve();});
  const button=host.querySelector('button')!;expect(button.disabled).toBe(false);const originalKey=latestKey;
  return{applied,published,reached:reached.promise,release:()=>release.resolve(),originalKey,currentKey:()=>latestKey,
    async start(){await act(async()=>{button.click();});expect(pending).toBeDefined();},
    async finish(){let accepted=false;await act(async()=>{accepted=await pending!;});return accepted;}};
}
for(const boundary of ['ACK','GET']as const){
  it(`S3 original operation owner survives a held ${boundary} only as accepted, never as new-buyer follow-up`,async()=>{
    const f=await fixture(boundary);await f.start();await f.reached;
    await act(async()=>{identity(null);identity('buyer-b');identity('buyer-a');});
    expect(getValidBuyer()?.globalUserId).toBe('buyer-a');f.release();expect(await f.finish()).toBe(true);
    expect(ports.accept).toHaveBeenCalledTimes(1);expect(ports.get).toHaveBeenCalledTimes(1);expect(f.applied).toEqual([after()]);
    expect(ports.post).not.toHaveBeenCalled();expect(f.published).toEqual([]);
  });
  it(`S3 buyer expiring during held ${boundary} cannot be recaptured as authorized anonymous follow-up`,async()=>{
    const f=await fixture(boundary);await f.start();await f.reached;const now=Date.now();
    vi.spyOn(Date,'now').mockReturnValue(now+3_601_000);expect(getValidBuyer()).toBeNull();
    f.release();expect(await f.finish()).toBe(true);expect(ports.accept).toHaveBeenCalledTimes(1);expect(f.applied).toEqual([after()]);
    expect(ports.post).not.toHaveBeenCalled();expect(f.published).toEqual([]);
  });
}
it('S3 owner listener survives accepted-cart Flow replacement until detached read settles',async()=>{
  const f=await fixture('READ');await f.start();await f.reached;expect(await f.finish()).toBe(true);
  expect(f.currentKey()).not.toBe(f.originalKey);expect(ports.post).toHaveBeenCalledTimes(1);
  await act(async()=>{identity(null);identity('buyer-b');identity('buyer-a');});f.release();await act(async()=>{await Promise.resolve();await Promise.resolve();});
  expect(f.published).toEqual([]);expect(ports.accept).toHaveBeenCalledTimes(1);expect(f.applied).toEqual([after()]);
});
it('S3 unchanged original buyer may publish after the new canonical applied-cart scope',async()=>{
  const f=await fixture('READ');await f.start();await f.reached;expect(await f.finish()).toBe(true);
  expect(f.currentKey()).not.toBe(f.originalKey);expect(f.published).toEqual([]);f.release();await act(async()=>{await Promise.resolve();await Promise.resolve();});
  expect(ports.post).toHaveBeenCalledTimes(1);expect(ports.post.mock.calls[0].slice(0,3)).toEqual(['cart','store','b']);
  expect(f.applied).toEqual([after()]);expect(f.published).toEqual([block()]);expect(ports.accept).toHaveBeenCalledTimes(1);
});

it('S3 five-tool v1 advertisement retains exact catalog actions without a question-write grant',async()=>{
  const {rememberStorefrontReadUiActionCapability,storefrontReadUiActionRequest,forgetStorefrontReadUiActionCapability}=await import('./storefront-read-ui-action');
  const conversationId='s3-v1-capability-'+Date.now()+'-'+Math.random(),merchantId='s3-capability-merchant';
  const capability={version:1,tools:['search_products','get_product_details','get_product_questions','ask_product_question','create_question']};
  const actions=[{tool:'get_product_details',args:{productId:'complement-product'}},{tool:'search_products',args:{query:'*',categoryId:'complement-category'}}]as const;
  try{
    rememberStorefrontReadUiActionCapability(conversationId,merchantId,capability);
    for(const action of actions)expect(storefrontReadUiActionRequest(conversationId,merchantId,action)).toEqual({ui_action_version:1,ui_action:action});
    expect(storefrontReadUiActionRequest(conversationId,'foreign-merchant',actions[0])).toBeUndefined();
    expect(storefrontReadUiActionRequest(conversationId+'-foreign',merchantId,actions[0])).toBeUndefined();
    expect(()=>storefrontReadUiActionRequest(conversationId,merchantId,{tool:'create_question',args:{productId:'complement-product',question:'Synthetic question'}})).toThrow('invalid_storefront_ui_action');
  }finally{forgetStorefrontReadUiActionCapability(conversationId);}
  expect(storefrontReadUiActionRequest(conversationId,merchantId,actions[0])).toBeUndefined();
});
