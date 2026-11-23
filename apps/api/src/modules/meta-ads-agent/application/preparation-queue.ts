import type {MetaAdsStoreState} from '../domain/types.js';
import type {MetaAdsPreparationLimits} from '@zyon/shared-types';

export const defaultPreparationLimits=():MetaAdsPreparationLimits=>({dailyNewProposals:1,maximumPendingProposals:3,version:0,updatedAt:null});

/** Counts campaigns once while retaining every unbound reservation. */
export function preparationQueue(state:MetaAdsStoreState):{pending:number;unboundReservations:number}{
 const queued=new Set<string>();let unboundReservations=0;
 for(const admission of Object.values(state.preparationAdmissions??{})){
  if(admission.state==='closed')continue;
  const campaign=admission.campaignId?state.campaigns[admission.campaignId]:undefined;
  if(!campaign){queued.add(`admission:${admission.id}`);unboundReservations++;}
  else if(campaign.managed&&!campaign.lifecycle&&!['delivered','active_unconfirmed'].includes(campaign.status))queued.add(`campaign:${campaign.id}`);
 }
 for(const proposal of Object.values(state.proposals)){
  const campaign=state.campaigns[proposal.campaignId];
  if(proposal.kind==='launch'&&proposal.status==='pending_review'&&!proposal.executionId&&campaign?.createdByAgent&&campaign.managed&&!campaign.lifecycle&&!campaign.remoteCampaignId)queued.add(`campaign:${campaign.id}`);
 }
 return{pending:queued.size,unboundReservations};
}
