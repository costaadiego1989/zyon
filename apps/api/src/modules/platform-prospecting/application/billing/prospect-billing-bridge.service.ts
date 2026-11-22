import {createHash,createHmac} from "node:crypto";
import type {ProspectBillingProposal,ProspectOffer} from "@zyon/shared-types";
import type {CanonicalBillingOfferPort,ProspectingActor} from "../../domain/prospecting.ports.js";
import type {SubscriptionAttribution,SubscriptionFinancialFact} from "../../../payment/domain/ports/subscription-attribution.port.js";
export interface BillingAccount {id:string;createdAt:Date;status:string|null;trialEndsAt:Date|null}
export interface ProposalStore{
 create(prospectId:string,offer:ProspectOffer,command:string,actor:ProspectingActor,nonceHash:(id:string)=>string):Promise<{id:string;expiresAt:string;version:number;offerVersion:string}>;
 bind(hash:string,account:BillingAccount,userId:string,offers:CanonicalBillingOfferPort):Promise<{boundMerchantId:string;next:"manage_subscription"|"select_plan"}>;
 subscriptionForPayment(merchantId:string,provider:string,paymentRef:string):Promise<string|null>;
 tracks(merchantId:string):Promise<boolean>;
 apply(fact:SubscriptionFinancialFact,account:{merchantId:string;planKey:string}):Promise<void>;
}
interface BillingFacts{
 account(merchantId:string,userId:string):Promise<BillingAccount>;
 customer(provider:"asaas"|"stripe",id:string):Promise<string|null>;
 subscription(fact:SubscriptionFinancialFact):Promise<{merchantId:string;planKey:string}|null>;
}
const digest=(text:string)=>createHash("sha256").update(text).digest("hex");
export class ProspectBillingBridgeService implements SubscriptionAttribution{
 constructor(private readonly store:ProposalStore,private readonly offers:CanonicalBillingOfferPort,private readonly facts:BillingFacts,private readonly secret:string){if(secret.length<32)throw Error("config_invalid:proposal_secret");}
 private nonce(id:string){return createHmac("sha256",this.secret).update("sales-signup:"+id).digest("base64url");}
 signupLink(id:string,offer:ProspectOffer){
  if(!this.offers.allowedUrl(offer.canonicalUrl))throw Error("invalid_offer_destination");
  const nonce=this.nonce(id),url=new URL(offer.canonicalUrl);url.searchParams.set("proposal",nonce);
  return {url:url.href,nonceHash:digest(nonce)};
 }
 async createSignupProposal(prospectId:string,planKey:string,clientRequestId:string,actor:ProspectingActor):Promise<ProspectBillingProposal>{
  const offer=await this.offers.current(planKey);if(!this.offers.allowedUrl(offer.canonicalUrl))throw Error("invalid_offer_destination");
  const record=await this.store.create(prospectId,offer,clientRequestId,actor,id=>this.signupLink(id,offer).nonceHash);
  if(!record?.id)throw Error("prospect_not_found");
  return {...record,prospectId,planKey,url:this.signupLink(record.id,offer).url,boundMerchantId:null};
 }
 async bindAuthenticatedAccount(token:string,merchantId:string,userId:string){
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error("invalid_proposal_token");
  return this.store.bind(digest(token),await this.facts.account(merchantId,userId),userId,this.offers);
 }
 async tracksCustomer(provider:"stripe"|"asaas",customerId:string){
  const merchant=await this.facts.customer(provider,customerId);return !!merchant&&await this.store.tracks(merchant);
 }
 async subscriptionForPayment(provider:"asaas"|"stripe",customerId:string,paymentRef:string){
  const merchant=await this.facts.customer(provider,customerId);return merchant?this.store.subscriptionForPayment(merchant,provider,paymentRef):null;
 }
 async observe(fact:SubscriptionFinancialFact){
  if(!fact.eventId||!fact.subscriptionId||!fact.paymentRef||!fact.customerId||!Number.isSafeInteger(fact.amountCents)||fact.amountCents<=0||!Number.isFinite(+fact.occurredAt))return;
  const account=await this.facts.subscription(fact);if(account)await this.store.apply(fact,account);
 }
}
