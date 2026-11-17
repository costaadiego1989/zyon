import {authorityFixture} from './authority-fixture.js';
import {installCampaignApprovalSchema} from '../../infrastructure/__tests__/campaign-approval-database.js';
import {PrismaCampaignPreparationRepository} from '../../infrastructure/prisma-campaign-preparation.repository.js';
import {PrismaCampaignReadyNoticeRepository} from '../../infrastructure/prisma-campaign-ready-notice.repository.js';
import {ExecutionService} from '../execution.service.js';

export const launchObjects=[{type:'campaign' as const,id:'200'},{type:'ad_set' as const,id:'300'},{type:'creative' as const,id:'400'},{type:'ad' as const,id:'500'}];
export async function campaignLaunchFixture(){
  const f=await authorityFixture(false,['owner-a','admin-a']);
  try{
    await installCampaignApprovalSchema(f.sql);
    const preparations=new PrismaCampaignPreparationRepository(f.prisma,f.clock),notices=new PrismaCampaignReadyNoticeRepository(f.prisma,f.clock);
    const executions=new ExecutionService(f.repo,f.commerce,f.service.campaigns,f.service.connection,f.provider,f.clock,undefined,{authority:f.authority,exposure:f.exposure,budgetControl:f.budgetControl});
    f.provider.execute=async(access,_campaign,_proposal,progress)=>{await access.assertWriteAuthorized!();f.calls.push('launch');await progress(launchObjects);return{status:'active_unconfirmed',objects:launchObjects};};
    return{...f,preparations,notices,executions};
  }catch(error){await f.close();throw error;}
}
