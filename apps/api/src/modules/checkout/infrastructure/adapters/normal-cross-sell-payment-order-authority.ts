import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { lockCheckoutSessionAnchor } from "../../../../shared/persistence/checkout-session-lock.js";
import { parseNormalCheckoutPaymentAuthority } from "../../../payment/domain/normal-checkout-payment-authority.schemas.js";
import { readPaymentNormalCrossSellAuthority } from "../../../payment/domain/payment-normal-cross-sell-authority.js";
import { readPaymentCouponAuthority } from "../../../payment/domain/payment-coupon-authority.js";

const conflict=():never=>{throw new Error("payment_normal_cross_sell_authority_conflict");};
const ref=z.string().min(1).max(200).refine(value=>value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value));
/** Historical approval only. Caller keeps this same transaction through order,
 * quota and outbox. Neither current catalog nor later contact grants a reprice. */
export async function assertNormalCrossSellPaymentOrderInTransaction(tx:Prisma.TransactionClient,merchantId:string,sessionId:string,
  expected:unknown,paymentIntentId:string,providerPaymentId:string):Promise<void>{
  const frozen=parseNormalCheckoutPaymentAuthority(expected);
  if(!ref.safeParse(providerPaymentId).success||frozen.merchantId!==merchantId||frozen.checkoutSessionId!==sessionId||frozen.paymentId!==paymentIntentId)return conflict();
  await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
  await lockCheckoutSessionAnchor(tx,merchantId,sessionId);
  await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${merchantId} AND session_id=${sessionId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM payment_intents WHERE id=${paymentIntentId} AND merchant_id=${merchantId} AND session_id=${sessionId} FOR UPDATE`;
  const row=await tx.paymentIntent.findFirst({where:{id:paymentIntentId,merchantId,sessionId},select:{id:true,merchantId:true,sessionId:true,version:true,
    status:true,amountCents:true,approvedAmountCents:true,providerPaymentId:true,currency:true,method:true,amountBreakdown:true,creation:true,acceptedOfferId:true}});
  if(!row||row.id!==paymentIntentId||row.merchantId!==merchantId||row.sessionId!==sessionId||row.status!=="approved"||row.providerPaymentId!==providerPaymentId
    ||(frozen.discountOwner?.kind==="accepted_offer"?row.acceptedOfferId!==null&&row.acceptedOfferId!==frozen.discountOwner.authorizedOfferId:row.acceptedOfferId!==null)
    ||!Number.isSafeInteger(row.version)||row.version<1||row.amountCents!==frozen.amountCents||row.approvedAmountCents!==row.amountCents
    ||row.currency!==frozen.currency||!isDeepStrictEqual(readPaymentNormalCrossSellAuthority(row),frozen))return conflict();
  const coupon=readPaymentCouponAuthority({...row,method:z.enum(["pix","card","boleto","crypto"]).parse(row.method)});
  if(frozen.amountBreakdown.discountCents>0&&!frozen.discountOwner&&(!coupon||coupon.cartId!==frozen.frozenProjection.cart.cart_ref||coupon.buyerId!==frozen.buyerId
    ||coupon.discountCents!==frozen.amountBreakdown.discountCents)||frozen.discountOwner&&coupon)return conflict();
}
