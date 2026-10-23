import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseNormalCheckoutPaymentAuthority } from "./normal-checkout-payment-authority.schemas.js";

type Scope={id:string;merchantId:string;sessionId:string;amountCents:number;currency:string;method:string;amountBreakdown?:unknown;creation?:unknown};
const keys=["normalCrossSellAuthority","normal_cross_sell_authority","normalCrossSellScope"] as const;
const conflict=():never=>{throw new Error("payment_normal_cross_sell_authority_conflict");};
export function assertNoPaymentNormalCrossSellAuthorityInProviderInput(input:unknown):void{
  try{if(input&&typeof input==="object"&&keys.some(key=>key in input))return conflict();}catch{return conflict();}
}
export function readPaymentNormalCrossSellAuthority(scope:Scope){
  try{
    const creation=scope.creation;if(!creation||typeof creation!=="object")return undefined;
    const present="normalCrossSellAuthority"in creation;
    const authority=Object.getOwnPropertyDescriptor(creation,"normalCrossSellAuthority"),input=Object.getOwnPropertyDescriptor(creation,"input");
    if(present&&(!authority?.enumerable||!("value"in authority)||!input?.enumerable||!("value"in input)))return conflict();
    const rawInput=present?input!.value:"input"in creation?creation.input:undefined;
    assertNoPaymentNormalCrossSellAuthorityInProviderInput(rawInput);
    if(!present)return undefined;
    if("widgetCheckoutAuthority"in creation)return conflict();
    const parsed=parseNormalCheckoutPaymentAuthority(authority!.value);
    const offerId=Reflect.get(scope,"acceptedOfferId");
    if(parsed.discountOwner?.kind==="accepted_offer"?offerId!=null&&offerId!==parsed.discountOwner.authorizedOfferId:!!offerId)return conflict();
    if(parsed.paymentId!==scope.id||parsed.merchantId!==scope.merchantId||parsed.checkoutSessionId!==scope.sessionId
      ||parsed.amountCents!==scope.amountCents||parsed.currency!==scope.currency||parsed.method!==scope.method
      ||!isDeepStrictEqual(parsed.amountBreakdown,scope.amountBreakdown)||!rawInput||typeof rawInput!=="object"
      ||["merchantId","sessionId","amountCents","currency","method"].some(key=>Reflect.get(rawInput,key)!==Reflect.get(scope,key))
      ||Reflect.get(rawInput,"intentId")!==scope.id)return conflict();
    return parsed;
  }catch{return conflict();}
}
export function assertSamePaymentNormalCrossSellAuthority(current:Scope,next:Scope):void{
  if(!isDeepStrictEqual(readPaymentNormalCrossSellAuthority(current),readPaymentNormalCrossSellAuthority(next)))return conflict();
}
/** Actual scoped JSONB row only, after the caller proves current-vs-next immutable
 * identity. This never turns a body payment ID into an ignore-list capability. */
export function assertNormalCrossSellOwnPaymentForFirstSend(actual:unknown,expected:{paymentId:string;version:number;merchantId:string;sessionId:string}):void{
  try{
    const row=z.object({id:z.string(),merchantId:z.string(),sessionId:z.string(),version:z.number().int().positive(),status:z.literal("pending"),
      providerPaymentId:z.nullish(z.never()),amountCents:z.number().int().positive(),currency:z.literal("BRL"),method:z.enum(["pix","card","boleto","crypto"]),
      amountBreakdown:z.unknown(),creation:z.object({state:z.literal("ready"),firstAttemptAt:z.undefined().optional(),cancellation:z.undefined().optional(),
        input:z.unknown(),normalCrossSellAuthority:z.unknown()}).passthrough()}).parse(actual);
    if(row.id!==expected.paymentId||row.version!==expected.version||row.merchantId!==expected.merchantId||row.sessionId!==expected.sessionId
      ||!readPaymentNormalCrossSellAuthority(row))return conflict();
  }catch{return conflict();}
}
