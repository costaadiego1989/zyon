import type { MetaAdsAutomationLimits, MetaAdsBudget, MetaAdsCampaign } from '@zyon/shared-types';
import type { MetaAccess } from './types.js';
import type { MetaBudgetEvidence } from './exposure.js';

export interface MetaBudgetControlReading extends MetaBudgetEvidence {
  kind: 'campaign_lifetime'; startsAt: string; endsAt: string;
  adSetId: string; adIds: string[]; fingerprint: string;
}
export interface MetaBudgetControlPort {
  read(access: MetaAccess, campaign: MetaAdsCampaign, scheduled?: boolean): Promise<MetaBudgetControlReading>;
  prove(access: MetaAccess, campaign: MetaAdsCampaign, target: MetaAdsBudget, limits: MetaAdsAutomationLimits, matchAmount?: boolean, scheduled?: boolean): Promise<MetaBudgetControlReading>;
}
