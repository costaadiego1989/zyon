import {validateServedModelScript} from './service-served-model-script.mjs';

/** Private local-test composition only. No issuer, guard, credential, route or
 * repository override is added; existing validators own all other options. */
export function isAllowedBuyerBookingFixture(options){
  if(!options||typeof options!=='object'||Array.isArray(options)||options.buyerBooking!==true)return false;
  if(options.buyerBrowser!==undefined&&options.buyerBrowser!==true)return false;
  if(options.buyerBrowser===true&&(options.storefrontQueryModel!==true||options.modelScript===undefined))return false;
  if(options.graph!==undefined&&options.graph!==false||options.whatsapp!==undefined
    ||options.supportQueryModel!==undefined||options.observeBusinessRag!==undefined)return false;
  if(options.storefrontQueryModel===undefined&&options.modelScript===undefined)return true;
  if(options.storefrontQueryModel!==true||options.modelScript===undefined)return false;
  try{validateServedModelScript(options.modelScript);return true;}catch{return false;}
}

/** Private test-only window check. The worker calls this only AFTER signature
 * verification and exact run/merchant/cart/origin checks. The parent additionally
 * requires a real201 continuation of the observed buyer capability, with its
 * preserved nonce/issuedAt and an expiry900 seconds inside that HTTP interval.
 * browserEnabled is the closed runtime flag, never a caller field or grant. */
export function isOwnedBuyerBrowserRenewalWindow(claims,browserEnabled,now=Math.floor(Date.now()/1000)){
  return Boolean(browserEnabled===true&&claims&&typeof claims==='object'&&!Array.isArray(claims)
    &&claims.typ==='aacp_embed_v1'&&claims.environment==='live'&&claims.allowedOrigin==='http://127.0.0.1:5188'
    &&typeof claims.nonce==='string'&&claims.nonce.trim()===claims.nonce&&claims.nonce.length>0&&claims.nonce!=='dev_bypass'
    &&typeof claims.merchantId==='string'&&claims.merchantId.length>0&&typeof claims.storefrontCartRef==='string'&&claims.storefrontCartRef.length>0
    &&claims.cartRef===undefined&&claims.whatsappCheckoutSessionId===undefined&&claims.paymentResume===undefined&&claims.recoveredCheckoutSessionId===undefined
    &&Array.isArray(claims.scopes)&&['checkout:start','appointments:confirm','payment:intents:read'].every(scope=>claims.scopes.includes(scope))
    &&Number.isSafeInteger(now)&&Number.isSafeInteger(claims.issuedAtUnix)&&Number.isSafeInteger(claims.expiresAtUnix)
    &&claims.issuedAtUnix<=now&&now-claims.issuedAtUnix<86400&&claims.expiresAtUnix<=claims.issuedAtUnix+86400
    &&claims.expiresAtUnix>now+5&&claims.expiresAtUnix<=now+900);
}
