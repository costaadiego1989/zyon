import type Stripe from "stripe";
import type {SubscriptionAttribution} from "../domain/ports/subscription-attribution.port.js";
const reference=(v:string|{id:string}|null|undefined)=>typeof v==="string"?v:v?.id;
const unknown="allocation_coverage_unknown" as const;

async function completePayment(stripe:Stripe,invoice:Stripe.Invoice){
 const payments=invoice.payments??await stripe.invoicePayments.list({invoice:invoice.id,status:"paid",limit:100});
 if(payments.has_more)return null;
 const paid=payments.data.filter(row=>row.status==="paid");
 if(paid.length!==1)return null;
 const row=paid[0],id=reference(row.payment.payment_intent);
 if(row.payment.type!=="payment_intent"||!id||reference(row.invoice)!==invoice.id||row.currency!==invoice.currency||
    !Number.isSafeInteger(invoice.amount_paid)||invoice.amount_paid<=0||row.amount_paid!==invoice.amount_paid)return null;
 return {id,amountCents:invoice.amount_paid};
}

export async function observeStripeSubscriptionPayment(stripe:Stripe,event:Stripe.Event,port:SubscriptionAttribution){
 if(event.account || !["invoice.paid","charge.refunded"].includes(event.type))return;
 const occurredAt=new Date(event.created*1000);
 if(event.type==="invoice.paid"){
  const invoice=event.data.object;
  const customerId=reference(invoice.customer),subscriptionId=reference(invoice.parent?.subscription_details?.subscription);
  if(!customerId||!subscriptionId||invoice.status!=="paid"||invoice.amount_paid<=0||invoice.currency!=="brl"||
    invoice.metadata?.zyon_module||invoice.parent?.subscription_details?.metadata?.zyon_module||
    !["subscription_create","subscription_cycle"].includes(invoice.billing_reason??"")||!await port.tracksCustomer("stripe",customerId))return;
  const payment=await completePayment(stripe,invoice);if(!payment)return unknown;
  await port.observe({provider:"stripe",eventId:event.id,state:"paid",paymentRef:payment.id,customerId,subscriptionId,amountCents:payment.amountCents,occurredAt});
 }else if(event.type==="charge.refunded"){
  const charge=event.data.object,customerId=reference(charge.customer),paymentRef=reference(charge.payment_intent);
  if(!customerId||!paymentRef||!charge.refunded||charge.amount_refunded!==charge.amount||charge.amount<=0||charge.currency!=="brl"||charge.metadata?.zyon_module||!await port.tracksCustomer("stripe",customerId))return;
  // A full charge refund can cover just one installment. Verify the invoice even for a historical receipt.
  const list=await stripe.invoicePayments.list({payment:{type:"payment_intent",payment_intent:paymentRef},status:"paid",limit:2});
  if(list.has_more||list.data.length!==1)return unknown;
  const invoiceId=reference(list.data[0].invoice);if(!invoiceId)return unknown;
  const invoice=await stripe.invoices.retrieve(invoiceId);
  if(reference(invoice.customer)!==customerId||invoice.currency!==charge.currency||invoice.metadata?.zyon_module||invoice.parent?.subscription_details?.metadata?.zyon_module||
    invoice.status!=="paid"||!["subscription_create","subscription_cycle"].includes(invoice.billing_reason??""))return;
  const subscriptionId=reference(invoice.parent?.subscription_details?.subscription),payment=await completePayment(stripe,invoice);
  if(!subscriptionId||!payment||payment.id!==paymentRef||payment.amountCents!==charge.amount_refunded)return unknown;
  await port.observe({provider:"stripe",eventId:event.id,state:"refunded",paymentRef,customerId,subscriptionId,amountCents:payment.amountCents,occurredAt});
 }
}
