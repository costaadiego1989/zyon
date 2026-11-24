import type {CrossSellDisplayProduct} from './storefront-cross-sell-flow';
export type PostCartSuggestions={type:'cross_sell';data:{trigger:string;displayMode?:'inline'|'banner'|'modal'|'interstitial';products:CrossSellDisplayProduct[]}};
export type PostAcceptRevision={key:string;revision:number};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,191}$/.test(value);
const text=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const money=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
function invalid():never{throw Error('post_add_suggestions_invalid');}
/** Same serialized revision as the existing buyer flow. No defaults replace an
 * unknown cart/identity; initial optional scope values retain their old shape. */
export function postAcceptCartKey(scope:{merchantId?:string;conversationId?:string|null},cart:{cartId?:string|null;items:ReadonlyArray<{variantId:string;quantity:number;price:number;optionItemIds?:string[]}>;total:number;discount?:number;couponCode?:string|null;freeShipping?:boolean}){
  return JSON.stringify([scope.merchantId,scope.conversationId,cart.cartId,cart.items.map(item=>[item.variantId,item.quantity,item.price,[...(item.optionItemIds??[])].sort()]),cart.total,cart.discount,cart.couponCode??null,cart.freeShipping??false]);
}
export function createPostAcceptReadGuard(captured:PostAcceptRevision,current:()=>PostAcceptRevision,mounted:()=>boolean,
  identity?:{captured:{buyerId:string|null;revision:number};current:()=>{buyerId:string|null;revision:number}}){
  const {key,revision}=captured;if(typeof key!=='string'||!Number.isSafeInteger(revision)||revision<0)invalid();
  const capturedIdentity=identity?{...identity.captured}:undefined;
  return()=>{const actual=current(),buyer=identity?.current();return mounted()&&actual.key===key&&actual.revision===revision
    &&(!capturedIdentity||(buyer?.buyerId===capturedIdentity.buyerId&&buyer?.revision===capturedIdentity.revision));};
}
export function parsePostAddCartResponse(value:unknown,scope:{merchantId:string;cartId:string;conversationId:string},variantId:string):Record<string,unknown>&{postCartSuggestions?:PostCartSuggestions}{
  if(!id(scope.merchantId)||!id(scope.cartId)||scope.cartId!==scope.conversationId||!id(variantId)||!record(value)||value.cartId!==scope.cartId
    ||!Array.isArray(value.items)||!money(value.total)||!money(value.discount)||!value.items.some(item=>record(item)&&item.variantId===variantId&&Number.isInteger(item.quantity)&&Number(item.quantity)>0))invalid();
  for(const item of value.items as unknown[])if(!record(item)||!id(item.variantId)||!Number.isInteger(item.quantity)||Number(item.quantity)<1||!money(item.price)
    ||(item.optionItemIds!==undefined&&(!Array.isArray(item.optionItemIds)||!item.optionItemIds.every(id))))invalid();
  const raw=value.postCartSuggestions;
  if(raw!==undefined){
    if(!record(raw)||!keys(raw,['type','data'])||raw.type!=='cross_sell'||!record(raw.data)||!keys(raw.data,['trigger','displayMode','products'])||!text(raw.data.trigger,2000)
      ||(raw.data.displayMode!==undefined&&!['inline','banner','modal','interstitial'].includes(String(raw.data.displayMode)))||!Array.isArray(raw.data.products)||raw.data.products.length<1||raw.data.products.length>10)invalid();
    const seen=new Set<string>();for(const product of raw.data.products as unknown[]){
      if(!record(product)||!keys(product,['id','productId','name','price','priceFormatted','inStock','image','promoId','recommendationRuleId','discountPercent','couponCode'])||!id(product.id)||!id(product.productId)
        ||!text(product.name,1000)||!money(product.price)||!text(product.priceFormatted,200)||product.inStock!==true||seen.has(String(product.id)))invalid();
      for(const field of ['promoId','recommendationRuleId'])if(product[field]!==undefined&&!id(product[field]))invalid();
      if(product.image!==undefined&&(typeof product.image!=='string'||product.image.length>2048||!/^https:\/\//.test(product.image)))invalid();
      if(product.couponCode!==undefined)invalid(); // This follow-up does not authorize a coupon.
      if(product.discountPercent!==undefined&&(typeof product.discountPercent!=='number'||!Number.isFinite(product.discountPercent)||product.discountPercent<=0||product.discountPercent>100))invalid();
      seen.add(String(product.id));
    }
  }
  return structuredClone(value) as Record<string,unknown>&{postCartSuggestions?:PostCartSuggestions};
}