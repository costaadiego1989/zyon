import type {MetaAdsAudienceSummary,MetaAdsCampaign,MetaAdsCampaignFilter,MetaAdsCampaignWorkspacePage,MetaAdsCampaignWorkspaceRow,MetaAdsWorkspaceQuery,MetaAdsCampaignObservation} from '@zyon/shared-types';
import {MetaAdsError,type Clock,type MetaAdsRepository,type MetaAdsStoreState,type MetaAccess,type MetaAdsProviderPort,type RemoteSnapshot} from '../domain/types.js';
import {requireIdentifier,stableDigest} from '../domain/offer.js';
import {buildMetrics} from '../domain/analytics.js';

const filters:MetaAdsCampaignFilter[]=['all','approval','running','paused','drafts','attention','archived'];
const processing=new Set(['reserved','sending','publishing']);
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const allowedCountry=(value:string)=>/^[A-Z]{2}$/.test(value);
const day=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const unavailableAudience=():MetaAdsAudienceSummary=>({source:'unavailable',countries:[],minimumAge:null,maximumAge:null,automatic:null,checkedAt:null});

interface Dependencies{repo:Pick<MetaAdsRepository,'read'> & Partial<Pick<MetaAdsRepository,'mutate'>>;canManage:(merchantId:string)=>Promise<boolean>;clock?:Clock;live?:{requireAccess(merchantId:string):Promise<unknown>;access(merchantId:string):Promise<MetaAccess>;provider:Pick<MetaAdsProviderPort,'snapshot'|'metrics'>;reconcile?(merchantId:string,id:string):Promise<unknown>};}
const observationLabels:Record<MetaAdsCampaignObservation['phase'],string>={active:'Ativa na Meta',delivering:'Em veiculação',processing:'Meta preparando a entrega',review:'Em análise na Meta',paused:'Pausada na Meta',rejected:'Anúncio precisa de ajuste',unavailable:'Situação não confirmada'};
const bindings=(c:MetaAdsCampaign)=>[c.remoteAccountId,c.remoteCampaignId,c.remoteAdSetId,[...c.remoteAdIds].sort()];
function observedAudience(snapshot:RemoteSnapshot,checkedAt:string):MetaAdsAudienceSummary{
 const t=snapshot.targeting as {geo_locations?:{countries?:unknown};age_min?:unknown;age_max?:unknown;targeting_automation?:{advantage_audience?:unknown}},countries=t.geo_locations?.countries;
 if(!Array.isArray(countries)||!countries.length||countries.length>50||countries.some(c=>typeof c!=='string'||!allowedCountry(c)))return unavailableAudience();
 const minimumAge=Number.isSafeInteger(t.age_min)&&Number(t.age_min)>=13&&Number(t.age_min)<=65?Number(t.age_min):null;
 const maximumAge=Number.isSafeInteger(t.age_max)&&Number(t.age_max)>=13&&Number(t.age_max)<=65&&(minimumAge===null||Number(t.age_max)>=minimumAge)?Number(t.age_max):null;
 const automatic=t.targeting_automation?.advantage_audience;
 return{source:'verified',countries:[...new Set(countries as string[])],minimumAge,maximumAge,automatic:automatic===true||automatic===1?true:automatic===false||automatic===0?false:null,checkedAt};
}
function phase(snapshot:RemoteSnapshot,metrics:MetaAdsCampaignObservation['metrics']):MetaAdsCampaignObservation['phase']{
 const states=[snapshot.status,snapshot.effectiveStatus,...(snapshot.objectStates??[]).flatMap(s=>[s.status,s.effectiveStatus])];
 if(states.some(s=>['DISAPPROVED','WITH_ISSUES'].includes(s)))return'rejected';
 if(states.some(s=>['PAUSED','CAMPAIGN_PAUSED','ADSET_PAUSED','ARCHIVED','DELETED'].includes(s)))return'paused';
 if(states.includes('PENDING_REVIEW'))return'review';
 if(states.some(s=>['IN_PROCESS','PREAPPROVED','PENDING_BILLING_INFO'].includes(s)))return'processing';
 if(snapshot.status==='ACTIVE'&&snapshot.effectiveStatus==='ACTIVE'&&snapshot.objectStates?.length&&snapshot.objectStates.every(s=>s.status==='ACTIVE'&&s.effectiveStatus==='ACTIVE'))return !metrics?.stale&&metrics?.impressions&&metrics.impressions>0?'delivering':'active';
 return'unavailable';
}
export class CampaignWorkspaceQueryService{
 private readonly clock:Clock;
 private readonly refreshing=new Map<string,Promise<MetaAdsCampaignWorkspaceRow>>();
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
  if(campaign.remoteAccountId&&campaign.remoteAccountId!==state.connection.account?.id)return unavailableAudience();
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
  const candidate=state.workspaceObservations?.[campaign.id];
  const observation=candidate&&candidate.accountId===state.connection.account?.id&&candidate.connectionEpoch===state.connection.epoch&&stableDigest([candidate.accountId,candidate.campaignId,candidate.adSetId,[...candidate.adIds].sort()])===stableDigest(bindings(campaign))&&Date.parse(candidate.checkedAt)>=Date.parse(campaign.updatedAt)?candidate:undefined;
  const cached=observation?.since===query.since&&observation.until===query.until?observation.metrics:state.metrics[campaign.id];
  const metrics=cached&&cached.since===query.since&&cached.until===query.until&&(!campaign.remoteAccountId||campaign.remoteAccountId===state.connection.account?.id)?{...structuredClone(cached),confirmedOrdersStatus:cached.confirmedOrdersStatus??(cached.source==='meta_reported'?'unavailable' as const:'available' as const)}:null;
  if(observation&&!archived&&!inFlight){stateLabel=observationLabels[observation.phase];if(['active','delivering','processing','review'].includes(observation.phase))group='running';else if(observation.phase==='paused')group='paused';else group='attention';}
  const mutable=canManage&&owned&&!inFlight&&!uncertain;
  const remoteMutable=mutable&&sameAccount&&!!campaign.remoteCampaignId;
  return{campaign:structuredClone(campaign),group,stateLabel,pendingProposalId:pending,audience:observation?.audience??this.audience(campaign,state),metrics,...(observation?{observation:structuredClone(observation)}:{}),actions:{pause:remoteMutable&&(group==='running'||endedActive),deleteDraft:mutable&&!campaign.remoteCampaignId,archive:remoteMutable&&group==='paused',verifyRemote:canManage&&owned&&sameAccount&&!!campaign.remoteCampaignId&&(uncertain||endedActive)}};
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
 async refresh(merchantId:string,campaignId:string,input:Record<string,unknown>={}):Promise<MetaAdsCampaignWorkspaceRow>{
  const initial=await this.detail(merchantId,campaignId,input),live=this.deps.live;
  if(!live||!this.deps.repo.mutate)throw new MetaAdsError('campaign_observation_unavailable',503);
  if(!await this.deps.canManage(merchantId))throw new MetaAdsError('meta_ads_role_forbidden',403);
  await live.requireAccess(merchantId);
  const campaign=initial.campaign,access=await live.access(merchantId),state=await this.deps.repo.read(merchantId),query=this.query(input,state);
  if(!campaign.createdByAgent||!campaign.managed||campaign.lifecycle?.state==='archived'||!campaign.remoteCampaignId||!campaign.remoteAdSetId||!campaign.remoteAdIds.length)throw new MetaAdsError('campaign_observation_unavailable',409);
  if(campaign.remoteAccountId!==access.accountId||state.connection.account?.id!==access.accountId||state.connection.epoch!==access.connectionEpoch)throw new MetaAdsError('meta_asset_forbidden',403);
  const key=stableDigest([merchantId,campaignId,access.accountId,access.connectionEpoch,bindings(campaign),query.since,query.until]);
  const existing=this.refreshing.get(key);if(existing)return existing;
  const task=this.observe(merchantId,campaign,access,query);this.refreshing.set(key,task);
  try{return await task;}finally{if(this.refreshing.get(key)===task)this.refreshing.delete(key);}
 }
 private async observe(merchantId:string,campaign:MetaAdsCampaign,access:MetaAccess,query:MetaAdsWorkspaceQuery):Promise<MetaAdsCampaignWorkspaceRow>{
  const live=this.deps.live!;
  const state=await this.deps.repo.read(merchantId),latest=Object.values(state.executions).filter(e=>e.campaignId===campaign.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  if(latest&&['active_unconfirmed','execution_unknown','publishing'].includes(latest.status)&&live.reconcile)await live.reconcile(merchantId,latest.id);
  const [snapshotResult,metricsResult]=await Promise.allSettled([live.provider.snapshot({...access},campaign),live.provider.metrics({...access},campaign,query.since,query.until)]);
  if(snapshotResult.status==='rejected'&&metricsResult.status==='rejected')throw new MetaAdsError('campaign_observation_unavailable',503);
  const checkedAt=this.clock().toISOString(),missing:MetaAdsCampaignObservation['missing']=[];
  let snapshot:RemoteSnapshot|null=null,metrics:MetaAdsCampaignObservation['metrics']=null,audience=unavailableAudience();
  if(snapshotResult.status==='fulfilled'){
   snapshot=snapshotResult.value;
   if(snapshot.campaignId!==campaign.remoteCampaignId||snapshot.adSetId!==campaign.remoteAdSetId||stableDigest([...snapshot.adIds].sort())!==stableDigest([...campaign.remoteAdIds].sort()))throw new MetaAdsError('meta_asset_forbidden',403);
   audience=observedAudience(snapshot,checkedAt);
  }else missing.push('status');
  if(audience.source==='unavailable')missing.push('audience');
  if(metricsResult.status==='fulfilled'){
   const value=metricsResult.value;if(value.campaignId!==campaign.id||value.since!==query.since||value.until!==query.until)throw new MetaAdsError('meta_asset_forbidden',403);
   metrics={...buildMetrics({campaignId:campaign.id,remote:value,orders:[],updatedAt:checkedAt}),source:'meta_reported',confirmedOrdersStatus:'unavailable',confirmedRevenueCents:null};
  }else{
   missing.push('metrics');const previous=state.workspaceObservations?.[campaign.id];
   if(previous?.metrics&&previous.accountId===access.accountId&&previous.connectionEpoch===access.connectionEpoch&&previous.since===query.since&&previous.until===query.until&&stableDigest([previous.accountId,previous.campaignId,previous.adSetId,[...previous.adIds].sort()])===stableDigest(bindings(campaign)))metrics={...previous.metrics,stale:true};
  }
  const observation:MetaAdsCampaignObservation={accountId:access.accountId!,connectionEpoch:access.connectionEpoch,campaignId:campaign.remoteCampaignId!,adSetId:campaign.remoteAdSetId!,adIds:[...campaign.remoteAdIds],checkedAt,since:query.since,until:query.until,phase:snapshot?phase(snapshot,metrics):'unavailable',audience,metrics,missing};
  return this.deps.repo.mutate!(merchantId,[],current=>{
   const c=current.campaigns[campaign.id];
   if(!c?.managed||c.lifecycle?.state==='archived'||current.connection.account?.id!==access.accountId||current.connection.epoch!==access.connectionEpoch||stableDigest(bindings(c))!==stableDigest(bindings(campaign)))throw new MetaAdsError('meta_connection_changed',409);
   current.workspaceObservations??={};current.workspaceObservations[c.id]=observation;
   return{result:this.row(c,current,query,true)};
  });
 }
}
