import type {MetaAdsApproveLaunchInput,MetaAdsBudgetAssessment,MetaAdsCampaignLaunchReview,MetaAdsCampaignNoticeContact,MetaAdsCampaignNoticeContactInput,MetaAdsCampaignPreparation,MetaAdsCampaignPreparationInput} from '@zyon/shared-types';
import {dashboardJson} from '../../api/http/client.js';

export interface CampaignPreparationView{campaignDigest:string;preparations:MetaAdsCampaignPreparation[];budgetAssessment?:MetaAdsBudgetAssessment;}
const aborted=()=>new DOMException('Contexto encerrado','AbortError');
/** One mounted store owns one instance; dispose it before changing the store. */
export function campaignApprovalEndpoints(base:string,f:typeof fetch=globalThis.fetch){
  const pending=new Set<AbortController>();let disposed=false;
  async function request<T>(path:string,method:'GET'|'POST'|'PUT',body?:unknown,signal?:AbortSignal,key?:string):Promise<T>{
    if(disposed||signal?.aborted)throw aborted();
    const controller=new AbortController();pending.add(controller);
    const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
    try{
      const result=await dashboardJson<T>(base,'/meta-ads-agent'+path,{method,...(body===undefined?{}:{jsonBody:body}),signal:controller.signal,...(key?{headers:{'Idempotency-Key':key}}:{})},f);
      if(disposed||controller.signal.aborted)throw aborted();return result;
    }catch(error){if(disposed||controller.signal.aborted)throw aborted();throw error;}
    finally{pending.delete(controller);signal?.removeEventListener('abort',cancel);}
  }
  const id=encodeURIComponent;
  return{
    dispose(){disposed=true;for(const controller of pending)controller.abort();pending.clear();},
    review:(campaignId:string,proposalId?:string,signal?:AbortSignal)=>request<MetaAdsCampaignLaunchReview>(`/campaigns/${id(campaignId)}/launch-review${proposalId?`?${new URLSearchParams({proposal:proposalId})}`:''}`,'GET',undefined,signal),
    preparation:(campaignId:string,signal?:AbortSignal)=>request<CampaignPreparationView>(`/campaigns/${id(campaignId)}/preparation`,'GET',undefined,signal),
    contact:(signal?:AbortSignal)=>request<MetaAdsCampaignNoticeContact>('/campaign-notice-contact','GET',undefined,signal),
    saveContact:(input:MetaAdsCampaignNoticeContactInput,signal?:AbortSignal)=>request<MetaAdsCampaignNoticeContact>('/campaign-notice-contact','PUT',{phoneNumber:input.phoneNumber,consented:input.consented,expectedVersion:input.expectedVersion},signal),
    prepare:(campaignId:string,input:MetaAdsCampaignPreparationInput,signal?:AbortSignal)=>request<MetaAdsCampaignPreparation>(`/campaigns/${id(campaignId)}/preparation`,'POST',{campaignDigest:input.campaignDigest,imageCount:input.imageCount},signal),
    approveLaunch:(campaignId:string,proposalId:string,input:MetaAdsApproveLaunchInput,signal?:AbortSignal)=>request<MetaAdsCampaignLaunchReview>(`/campaigns/${id(campaignId)}/proposals/${id(proposalId)}/approve-launch`,'POST',{digest:input.digest,idempotencyKey:input.idempotencyKey},signal,input.idempotencyKey),
  };
}
export type CampaignApprovalApi=ReturnType<typeof campaignApprovalEndpoints>;
