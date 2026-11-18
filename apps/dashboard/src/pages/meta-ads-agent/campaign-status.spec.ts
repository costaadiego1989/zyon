import {expect,test} from 'vitest';
import {campaign,overview,proposal} from './fixtures.js';
import {campaignState,matchesCampaignFilter} from './campaign-status.js';
const now=Date.parse('2026-11-18T12:00:00Z');
test('AGW-05 counts only the latest current pending proposal and rejects expired or dispatched review',()=>{
 const c=campaign(),data=overview();data.campaigns=[c];const p={...proposal(),kind:'launch' as const};data.proposals=[p];
 expect(campaignState(c,data,now).pending?.id).toBe(p.id);
 for(const change of [{status:'stale' as const},{status:'executed' as const},{status:'rejected' as const},{connectionEpoch:2},{executionId:'sent'}]){data.proposals=[{...p,...change}];expect(campaignState(c,data,now).pending).toBeNull();}
 data.proposals=[p,{...p,id:'new',status:'rejected',createdAt:'2026-11-18T10:00:00Z'}];expect(campaignState(c,data,now).pending).toBeNull();
 data.proposals=[p];data.executions=[{id:'sent',proposalId:p.id,campaignId:c.id,status:'execution_unknown',objects:[],error:null,updatedAt:'2026-11-18T10:00:00Z'}];
 expect(campaignState(c,data,now)).toMatchObject({group:'attention',pending:null});
 data.executions=[];c.draft.budget!.endsAt='2026-11-18T12:00:00Z';expect(campaignState(c,data,now).pending).toBeNull();
 c.draft.budget!.endsAt=null;data.connection.account=null;expect(campaignState(c,data,now).pending).toBeNull();
});
test('AGW-05 running and paused states stay distinct and unknown activity never promises delivery',()=>{
 const c=campaign(),data=overview();
 c.status='delivered';expect(campaignState(c,data,now)).toMatchObject({group:'running',label:'Veiculação confirmada'});
 c.status='active_unconfirmed';const unconfirmed=campaignState(c,data,now);expect(unconfirmed).toMatchObject({group:'running',label:'Ativa, veiculação ainda não confirmada'});
 expect(matchesCampaignFilter(unconfirmed,'running')).toBe(true);expect(matchesCampaignFilter(unconfirmed,'paused')).toBe(false);
 c.status='remote_paused';expect(campaignState(c,data,now).group).toBe('paused');
 c.status='execution_unknown';expect(campaignState(c,data,now).group).toBe('attention');
 c.status='draft';expect(campaignState(c,data,now).group).toBe('drafts');
 c.createdByAgent=false;data.proposals=[proposal()];expect(campaignState(c,data,now).pending).toBeNull();
});
