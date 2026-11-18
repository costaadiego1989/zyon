import type {MetaAdsCampaign,MetaAdsOverview,MetaAdsProposal} from '@zyon/shared-types';
import {executionStates} from './presentation.js';

export type CampaignFilter='all'|'approval'|'running'|'paused'|'drafts'|'attention';
export interface CampaignState {group:Exclude<CampaignFilter,'all'|'approval'>;label:string;pending:MetaAdsProposal|null;}
export const campaignFilters:ReadonlyArray<{key:CampaignFilter;label:string}>=[{key:'all',label:'Todas'},{key:'approval',label:'Aguardando aprovação'},{key:'running',label:'Em veiculação'},{key:'paused',label:'Pausadas'},{key:'drafts',label:'Rascunhos e preparo'},{key:'attention',label:'Precisam de atenção'}];

/** Display only: authorizing any change still belongs to the existing review API. */
export function campaignState(campaign:MetaAdsCampaign,overview:MetaAdsOverview,now=Date.now()):CampaignState {
 const executions=overview.executions.filter(e=>e.campaignId===campaign.id);
 const uncertain=executions.some(e=>e.status==='execution_unknown');
 const processing=executions.some(e=>['reserved','sending','publishing'].includes(e.status));
 const latest=overview.proposals.filter(p=>p.campaignId===campaign.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0];
 const end=campaign.draft.budget?.endsAt;
 const validEnd=!end||Number.isFinite(Date.parse(end))&&Date.parse(end)>now;
 const pending=campaign.managed&&campaign.createdByAgent&&overview.connection.account&&(!campaign.remoteAccountId||campaign.remoteAccountId===overview.connection.account.id)&&validEnd&&!uncertain&&!processing&&latest?.status==='pending_review'&&latest.connectionEpoch===overview.connection.epoch&&!latest.executionId&&!executions.some(e=>e.proposalId===latest.id)?latest:null;
 if(!campaign.managed||!campaign.createdByAgent)return {group:'drafts',label:'Histórico, sem gerenciamento',pending:null};
 if(uncertain||campaign.status==='execution_unknown')return {group:'attention',label:executionStates.execution_unknown,pending:null};
 if(processing)return {group:'drafts',label:'Alteração em processamento',pending:null};
 if(['active_unconfirmed','delivered'].includes(campaign.status))return {group:'running',label:executionStates[campaign.status as 'active_unconfirmed'|'delivered'],pending};
 if(['remote_paused','remote_draft'].includes(campaign.status))return {group:'paused',label:executionStates[campaign.status as 'remote_paused'|'remote_draft'],pending};
 if(campaign.status==='failed')return {group:'attention',label:executionStates.failed,pending};
 return {group:'drafts',label:campaign.status==='draft'?'Rascunho local':executionStates[campaign.status],pending};
}
export function matchesCampaignFilter(state:CampaignState,filter:CampaignFilter):boolean {
 return filter==='all'||filter==='approval'&&!!state.pending||filter===state.group&&(filter!=='drafts'||!state.pending);
}
