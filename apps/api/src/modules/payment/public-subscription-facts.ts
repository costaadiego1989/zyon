import type {PrismaClient} from "@prisma/client";
import type {SubscriptionFinancialFact} from "./domain/ports/subscription-attribution.port.js";
export class PublicSubscriptionFacts {
 constructor(private readonly db:PrismaClient){}
 async account(merchantId:string,userId:string){
  const membership=await this.db.merchantTeamMember.findUnique({where:{merchantId_userId:{merchantId,userId}},select:{role:true}});
  if(!membership||!["OWNER","ADMIN"].includes(membership.role))throw Error("account_authority_required");
  const store=await this.db.merchant.findUniqueOrThrow({where:{id:merchantId},select:{billingAccountMerchantId:true}});
  const id=store.billingAccountMerchantId??merchantId;
  if(id!==merchantId){
   const root=await this.db.merchantTeamMember.findUnique({where:{merchantId_userId:{merchantId:id,userId}},select:{role:true}});
   if(!root||!["OWNER","ADMIN"].includes(root.role))throw Error("account_authority_required");
  }
  const account=await this.db.merchant.findUniqueOrThrow({where:{id},select:{createdAt:true}});
  const sub=await this.db.merchantBillingSubscription.findUnique({where:{merchantId:id},select:{status:true,trialEndsAt:true}});
  return {id,createdAt:account.createdAt,status:sub?.status??null,trialEndsAt:sub?.trialEndsAt??null};
 }
 async customer(provider:"stripe"|"asaas",customerId:string){
  if(!customerId)return null;
  const rows=await this.db.merchantBillingSubscription.findMany({where:provider==="stripe"?{stripeCustomerId:customerId}:{asaasCustomerId:customerId},select:{merchantId:true},take:2});
  return rows.length===1?rows[0].merchantId:null;
 }
 async subscription(f:SubscriptionFinancialFact){
  const rows=await this.db.merchantBillingSubscription.findMany({where:f.provider==="stripe"?{stripeSubscriptionId:f.subscriptionId,stripeCustomerId:f.customerId,provider:"stripe"}:{asaasSubscriptionId:f.subscriptionId,asaasCustomerId:f.customerId,provider:"asaas"},select:{merchantId:true,planKey:true,status:true},take:2});
  const row=rows.length===1?rows[0]:null;if(!row?.planKey)return null;
  if(f.state==="paid"){
    if(row.status!=="active"||row.planKey==="starter")return null;
    if(f.provider==="asaas"){
      const event=await this.db.billingWebhookEvent.findUnique({where:{provider_eventId:{provider:"asaas",eventId:f.eventId}}});
      if(event?.outcome!=="processed"||event.paymentId!==f.paymentRef||event.subscriptionId!==f.subscriptionId||event.merchantId!==row.merchantId)return null;
    }
  }
  return {merchantId:row.merchantId,planKey:row.planKey};
 }
}
