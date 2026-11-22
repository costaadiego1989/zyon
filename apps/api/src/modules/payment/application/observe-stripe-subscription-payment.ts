import type Stripe from "stripe";
import type {SubscriptionAttribution} from "../domain/ports/subscription-attribution.port.js";
const reference=(v:string|{id:string}|null|undefined)=>typeof v==="string"?v:v?.id;
export async function observeStripeSubscriptionPayment(stripe:Stripe,event:Stripe.Event,port:SubscriptionAttribution){
 if(event.account || !["invoice.paid","charge.refunded"].includes(event.type))return;
 const occurredAt=new Date(event.created*1000);
 if(event.type==="invoice.paid"){
  const invoice=event.data.object;
  const customerId=reference(invoice.customer),subscriptionId=reference(invoice.parent?.subscription_details?.subscription);
  if(!customerId||!subscriptionId||invoice.status!=="paid"||invoice.amount_paid<=0||invoice.currency!=="brl"||
    invoice.metadata?.zyon_module||invoice.parent?.subscription_details?.metadata?.zyon_module||
    !["subscription_create","subscription_cycle"].includes(invoice.billing_reason??"")||!await port.tracksCustomer("stripe",customerId))return;
  const payments=invoice.payments??await stripe.invoicePayments.list({invoice:invoice.id,status:"paid",limit:100});
  // Only a paid provider payment backing the invoice can open attribution. Manual out-of-band marks have none.
  for(const row of payments.data){
   const ref=reference(row.payment.payment_intent);
   if(row.status!=="paid"||row.payment.type!=="payment_intent"||!ref||reference(row.invoice)!==invoice.id||row.currency!==invoice.currency||!row.amount_paid)continue;
   await port.observe({provider:"stripe",eventId:event.id,state:"paid",paymentRef:ref,customerId,subscriptionId,amountCents:row.amount_paid,occurredAt});
   break;
  }
 }else if(event.type==="charge.refunded"){
  const charge=event.data.object,customerId=reference(charge.customer),paymentRef=reference(charge.payment_intent);
  if(!customerId||!paymentRef||!charge.refunded||charge.amount_refunded!==charge.amount||charge.amount<=0||charge.currency!=="brl"||charge.metadata?.zyon_module||!await port.tracksCustomer("stripe",customerId))return;
  let subscriptionId=await port.subscriptionForPayment("stripe",customerId,paymentRef);
  if(!subscriptionId){
   const list=await stripe.invoicePayments.list({payment:{type:"payment_intent",payment_intent:paymentRef},status:"paid",limit:2});
   if(list.has_more || list.data.length!==1)return;
   const invoiceId=reference(list.data[0].invoice);if(!invoiceId)return;
   const invoice=await stripe.invoices.retrieve(invoiceId);if(reference(invoice.customer)!==customerId||invoice.metadata?.zyon_module||invoice.parent?.subscription_details?.metadata?.zyon_module)return;
   subscriptionId=reference(invoice.parent?.subscription_details?.subscription)??null;
  }
  if(subscriptionId)await port.observe({provider:"stripe",eventId:event.id,state:"refunded",paymentRef,customerId,subscriptionId,amountCents:charge.amount_refunded,occurredAt});
 }
}
