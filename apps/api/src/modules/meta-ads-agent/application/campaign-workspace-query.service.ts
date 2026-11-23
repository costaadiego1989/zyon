import type {MetaAdsAudienceSummary,MetaAdsCampaign,MetaAdsCampaignFilter,MetaAdsCampaignWorkspacePage,MetaAdsCampaignWorkspaceRow,MetaAdsWorkspaceQuery} from '@zyon/shared-types';
import {MetaAdsError,type Clock,type MetaAdsRepository,type MetaAdsStoreState} from '../domain/types.js';
import {requireIdentifier} from '../domain/offer.js';

const filters:MetaAdsCampaignFilter[]=['all','approval','running','paused','drafts','attention','archived'];
const processing=new Set(['reserved','sending','publishing']);
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const allowedCountry=(value:string)=>/^[A-Z]{2}$/.test(value);
const day=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const unavailableAudience=():MetaAdsAudienceSummary=>({source:'unavailable',countries:[],minimumAge:null,maximumAge:null,automatic:null,checkedAt:null});

interface Dependencies{repo:Pick<MetaAdsRepository,'read'>;canManage:(merchantId:string)=>Promise<boolean>;clock?:Clock;}
export class CampaignWorkspaceQueryService{
 private readonly clock:Clock;
 constructor(private readonly deps:Dependencies){this.clock=deps.clock??(()=>new Date());}
 private query(input:Record<string,unknown>,state:MetaAdsStoreState):MetaAdsWorkspaceQuery{
  const latest=Object.values(state.metrics).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const until=input.until??latest?.until??this.clock().toISOString().slice(0,10);
  const since=input.since??latest?.since??new Date(this.clock().getTime()-6*86400000).toISOString().slice(0,10);
  const filter=input.filter??'all',search=input.search??'',rawPage=input.page??1;
  const page=typeof rawPage==='string'&&/^\d+$/.test(rawPage)?Number(rawPage):rawPage;
  if(Object.keys(input).some(key=>!['since','until','filter','search','page'].includes(key))||!day(since)||!day(until)||since>until||Date.parse(until)-Date.parse(since)>366*86400000||!filters.includes(filter as MetaAdsCampaignFilter)||typeof search!=='string'||search.length>200||/[\x00-\x1f]/.test(search)||typeof page!=='number'||!Number.isSafeInteger(page)||page<1)throw new MetaAdsError('workspace_query_invalid');
  return{filter:filter as MetaAdsCampaignFilter,search:search.trim(),page,since,until};
 }
 private audience(campaign:MetaAdsCampaign,state:MetaAdsStoreState):MetaAdsAudienceSummary{
  const snapshot=state.audienceSnapshots?.[campaign.id];
  if(snapshot){return{source:snapshot.source,countries:[...snapshot.countries],minimumAge:snapshot.minimumAge,maximumAge:snapshot.maximumAge,automatic:snapshot.automatic,checkedAt:snapshot.checkedAt};}
  if(campaign.remoteCampaignId||!campaign.createdByAgent||!allowedCountry(campaign.draft.country))return unavailableAudience();
  return{source:'planned',countries:[campaign.draft.country],minimumAge:18,maximumAge:null,automatic:true,checkedAt:null};
 }
 private row(campaign:MetaAdsCampaign,state:MetaAdsStoreState,query:MetaAdsWorkspaceQuery,canManage:boolean):MetaAdsCampaignWorkspaceRow{
  const now=this.clock().getTime(),archived=campaign.lifecycle?.state==='archived';
  const executions=Object.values(state.executions).filter(e=>e.campaignId===campaign.id);
  const uncertain=campaign.status==='execution_unknown'||executions.some(e=>e.status==='execution_unknown');
  const inFlight=executions.some(e=>processing.has(e.status));
  const owned=campaign.createdByAgent&&campaign.managed&&!archived;
  const sameAccount=!!state.connection.account&&(!campaign.remoteAccountId||campaign.remoteAccountId===state.connection.account.id);
  const end=campaign.draft.budget?.endsAt,validEnd=!end||Number.isFinite(Date.parse(end))&&Date.parse(end)>now;
  const ended=!!end&&Number.isFinite(Date.parse(end))&&Date.parse(end)<=now;
  const endedActive=ended&&!!campaign.remoteCampaignId&&['delivered','active_unconfirmed'].includes(campaign.status);
  const latest=Object.values(state.proposals).filter(p=>p.campaignId===campaign.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0];
  const pending=owned&&sameAccount&&validEnd&&!uncertain&&!inFlight&&latest?.status==='pending_review'&&latest.connectionEpoch===state.connection.epoch&&!latest.executionId&&!executions.some(e=>e.proposalId===latest.id)?latest.id:null;
  let group:MetaAdsCampaignWorkspaceRow['group']='drafts',stateLabel='Rascunho';
  if(archived){group='archived';stateLabel='Arquivada';}
  else if(!owned)stateLabel='Somente análise';
  else if(uncertain){group='attention';stateLabel='Aguardando confirmação';}
  else if(inFlight)stateLabel='Alteração em andamento';
  else if(endedActive){group='attention';stateLabel='Período encerrado · confirme a pausa';}
  else if(ended&&campaign.remoteCampaignId){group='paused';stateLabel='Período encerrado';}
  else if(campaign.status==='delivered'){group='running';stateLabel='Em veiculação';}
  else if(campaign.status==='active_unconfirmed'){group='running';stateLabel='Publicada · entrega não confirmada';}
  else if(['remote_paused','remote_draft'].includes(campaign.status)){group='paused';stateLabel='Pausada';}
  else if(campaign.status==='failed'){group='attention';stateLabel='Precisa de atenção';}
  const cached=state.metrics[campaign.id];
  const metrics=cached&&cached.since===query.since&&cached.until===query.until&&(!campaign.remoteAccountId||campaign.remoteAccountId===state.connection.account?.id)?{...structuredClone(cached),confirmedOrdersStatus:cached.confirmedOrdersStatus??(cached.source==='meta_reported'?'unavailable' as const:'available' as const)}:null;
  const mutable=canManage&&owned&&!inFlight&&!uncertain;
  const remoteMutable=mutable&&sameAccount&&!!campaign.remoteCampaignId;
  return{campaign:structuredClone(campaign),group,stateLabel,pendingProposalId:pending,audience:this.audience(campaign,state),metrics,actions:{pause:remoteMutable&&(group==='running'||endedActive),deleteDraft:mutable&&!campaign.remoteCampaignId,archive:remoteMutable&&group==='paused',verifyRemote:canManage&&owned&&sameAccount&&!!campaign.remoteCampaignId&&(uncertain||endedActive)}};
 }
 async list(merchantId:string,input:Record<string,unknown>={}):Promise<MetaAdsCampaignWorkspacePage>{
  requireIdentifier(merchantId);const state=await this.deps.repo.read(merchantId),query=this.query(input,state),canManage=await this.deps.canManage(merchantId);
  const rows=Object.values(state.campaigns).filter(c=>c.lifecycle?.state!=='deleted_draft').filter(c=>!query.search||normalize([c.draft.name,...c.products.map(p=>p.name),...c.products.map(p=>p.sku)].join(' ')).includes(normalize(query.search))).sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0)||a.id.localeCompare(b.id)).map(c=>this.row(c,state,query,canManage));
  const matches=(row:MetaAdsCampaignWorkspaceRow,filter:MetaAdsCampaignFilter)=>filter==='archived'?row.group==='archived':row.group==='archived'?false:filter==='all'||filter==='approval'&&!!row.pendingProposalId||filter===row.group&&(filter!=='drafts'||!row.pendingProposalId);
  const counts=Object.fromEntries(filters.map(filter=>[filter,rows.filter(row=>matches(row,filter)).length])) as Record<MetaAdsCampaignFilter,number>;
  const filtered=rows.filter(row=>matches(row,query.filter)),pages=Math.max(1,Math.ceil(filtered.length/10)),page=Math.min(query.page,pages);
  return{items:filtered.slice((page-1)*10,page*10),total:filtered.length,page,pageSize:10,pages,counts,query:{...query,page},asOf:this.clock().toISOString()};
 }
 async detail(merchantId:string,campaignId:string,input:Record<string,unknown>={}):Promise<MetaAdsCampaignWorkspaceRow>{
  requireIdentifier(merchantId);requireIdentifier(campaignId);const state=await this.deps.repo.read(merchantId),campaign=Object.hasOwn(state.campaigns,campaignId)?state.campaigns[campaignId]:null;
  if(!campaign||campaign.lifecycle?.state==='deleted_draft')throw new MetaAdsError('campaign_not_found',404);
  return this.row(campaign,state,this.query(input,state),await this.deps.canManage(merchantId));
 }
}
