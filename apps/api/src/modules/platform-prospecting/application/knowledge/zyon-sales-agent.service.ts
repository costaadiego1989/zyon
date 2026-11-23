import {isSafeGeneratedMessage} from "@zyon/conversation-engine";
import type {SalesKnowledgeQuery,ProspectOfferPolicy} from "@zyon/shared-types";
import type {CanonicalBillingOfferPort,SalesKnowledgePort,SalesLlmPort} from "../../domain/prospecting.ports.js";
import type {ProspectConversationService} from "../conversations/prospect-conversation.service.js";
import {formatSalesOffer,formatSalesCatalog,SALES_QUALIFICATION} from "../../domain/sales-answer.js";
import {stableDirectoryJson} from "../../domain/company-directory/directory-values.js";

export interface SalesInbound {conversationId:string;messageId:string;expectedEpoch:number}
export interface SalesGenerationStore {
  salesContext(input:SalesInbound):Promise<{text:string;prepared:string|null;offerPolicy?:ProspectOfferPolicy;businessContext?:string|null;companyContext?:Record<string,string|null>;campaignReview?:{id:string;revision:number;hash:string}}>;
  handoff(input:SalesInbound,reason:string):Promise<void>;
}
export class ZyonSalesAgentService {
  constructor(private readonly store:SalesGenerationStore, private readonly conversation:Pick<ProspectConversationService,"prepareAi">,
    private readonly knowledge:Pick<SalesKnowledgePort,"queryPublishedKnowledge">,private readonly offers:CanonicalBillingOfferPort,
    private readonly llm:SalesLlmPort,private readonly limits:{maximumCostCents:number;timeoutMs:number}){}
  async respond(input:SalesInbound & {query:SalesKnowledgeQuery;planKey?:string}):Promise<{messageId:string|null;reason:string|null}>{
    try{
      const context=await this.store.salesContext(input);
      if(context.prepared)return {messageId:context.prepared,reason:null};
      const catalogMode=context.offerPolicy?.mode==="catalog";
      let facts=await this.knowledge.queryPublishedKnowledge(input.query,new Date());
      if(!facts.length&&catalogMode&&/^(?:sim|quero conhecer|quero saber mais|ol[aá]|oi|quais (?:s[aã]o )?os planos dispon[ií]veis)[.!?\s]*$/iu.test(context.text.trim()))facts=await this.knowledge.queryPublishedKnowledge({operation:"answer_faq",params:{question:"zyon"},limit:10},new Date());
      if(!facts.length)throw Error("knowledge_unavailable");
      const values=new Map<string,string>();
      for(const f of facts){
        const key=JSON.stringify([f.subject.toLowerCase(),f.predicate]);
        if(values.has(key)&&values.get(key)!==f.value)throw Error("knowledge_conflict");
        values.set(key,f.value);
      }
      const planKey=context.offerPolicy?.mode==="fixed"?context.offerPolicy.planKey:input.planKey;
      const catalog=catalogMode?await this.offers.catalog?.():undefined;
      if(catalogMode&&(!catalog?.length||catalog.length>20||new Set(catalog.map(o=>o.planKey)).size!==catalog.length))throw Error("offer_unavailable");
      const offer=catalogMode?null:planKey?await this.offers.current(planKey):null;
      if(!catalogMode&&!offer)throw Error("offer_unavailable");
      if([...(catalog??[]),...(offer?[offer]:[])].some(o=>!this.offers.allowedUrl(o.canonicalUrl)))throw Error("invalid_offer_destination");
      const siteUrl=this.offers.publicSite?.()??undefined;
      if(siteUrl && !this.offers.allowedUrl(siteUrl))throw Error("invalid_site_destination");
      const requestId="sales."+input.messageId;
      const result=await this.llm.respond({requestId,conversationId:input.conversationId,controlEpoch:input.expectedEpoch,input:context.text,facts,offer,siteUrl,...(catalogMode?{catalog,offerPolicy:context.offerPolicy,businessContext:context.businessContext?.slice(0,4000)??null,companyContext:context.companyContext}:{}),
        allowedTools:catalogMode?["knowledge","canonical_offer","canonical_catalog","allowed_link","qualify","human_handoff"]:["knowledge","canonical_offer","allowed_link","qualify","human_handoff"],...this.limits});
      if(result.handoff||!result.answer)throw Error(result.reason??"model_unavailable");
      const selected=result.facts.map(proposed=>facts.find(f=>stableDirectoryJson(f)===stableDirectoryJson(proposed)));
      if(selected.some(f=>!f))throw Error("invalid_generated_fact");
      const approved=selected.filter(f=>f!==undefined);
      if(result.offer && !(catalog??(offer?[offer]:[])).some(o=>stableDirectoryJson(o)===stableDirectoryJson(result.offer)))throw Error("offer_conflict");
      if(result.catalog&&(!catalogMode||stableDirectoryJson(result.catalog)!==stableDirectoryJson(catalog)))throw Error("offer_conflict");
      const information=approved.length>0 && approved.every(f=>!/(?:https?:|www\.|\bR\$|\bBRL\b|\d\s*%|desconto|em breve|planejad|roadmap|faturamento da sua|decisor da sua)/iu.test(f.value)) && result.answer===approved.map(f=>f.value).join("\n");
      const destination=result.linkDestination;
      const selectedOffer=result.offer??offer;
      const linkUrl=destination==="signup"?selectedOffer?.canonicalUrl:destination==="site"?siteUrl:undefined;
      const authorized=destination?(destination==="site"||!!result.offer)&&linkUrl&&result.answer===linkUrl:information || result.answer===SALES_QUALIFICATION || result.offer && result.answer===formatSalesOffer(result.offer) || result.catalog&&result.answer===formatSalesCatalog(result.catalog);
      if(!authorized || !isSafeGeneratedMessage(result.answer))throw Error("invalid_generated_answer");
      const evidence={messageId:input.messageId,offer:catalogMode?result.offer:offer,...(catalogMode?{catalog,campaignReview:context.campaignReview}:{}),...(destination && linkUrl?{link:{destination,url:linkUrl}}:{}),facts:facts.map(({id,sourceId,publicationId,publicationVersion})=>({id,sourceId,publicationId,publicationVersion}))};
      const msg=await this.conversation.prepareAi(input.conversationId,{clientRequestId:requestId,expectedEpoch:input.expectedEpoch,content:result.answer,evidence});
      return {messageId:msg.id,reason:null};
    }catch(e){
      const reason=e instanceof Error && /^[a-z_]{1,80}$/.test(e.message)?e.message:"sales_unavailable";
      await this.store.handoff(input,reason);
      return {messageId:null,reason};
    }
  }
}
