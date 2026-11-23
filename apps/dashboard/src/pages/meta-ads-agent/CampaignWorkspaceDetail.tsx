import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft} from 'lucide-react';
import type {MetaAdsCampaignWorkspaceRow,MetaAdsOverview,MetaAdsExecution,MetaAdsProposal} from '@zyon/shared-types';
import type {MetaAdsAgentApi} from '../../api/endpoints/meta-ads-agent.js';
import type {CampaignApprovalApi} from './api.js';
import {CampaignPreparationPanel} from './CampaignPreparationPanel.js';
import {DraftCampaignPreview} from './DraftCampaignPreview.js';
import {ProposalReview} from './ProposalReview.js';
import {campaignAudience} from './CampaignWorkspace.js';
import {executionFeedback,executionStates,useAction} from './presentation.js';
import './campaign-workspace.css';
export interface CampaignWorkspaceDetailProps {reviewProposalId?:string;merchantId:string;row:MetaAdsCampaignWorkspaceRow;overview:MetaAdsOverview;api:MetaAdsAgentApi;approval:CampaignApprovalApi;onBack():void;onUpdated():void|Promise<void>;onEdit():void;onSetup():void;onCorrectBudget?():void;children?:ReactNode;pollMs?:number}
function ExecutionReadback({execution,api,onUpdated}:{execution:MetaAdsExecution;api:MetaAdsAgentApi;onUpdated():void|Promise<void>}){const [result,setResult]=useState(execution),action=useAction();return <section className="ads-detail__change" aria-label="Situação da alteração"><h3>Conferir situação da campanha</h3><p role="status">{executionStates[result.status]}</p>{['sending','execution_unknown','publishing','active_unconfirmed','remote_draft'].includes(result.status)&&<button type="button" className="zyn-btn zyn-btn--outline" disabled={action.busy} onClick={()=>void action.run(async()=>{const next=await api.reconcile(result.id);setResult(next);await onUpdated();return next;},executionFeedback)}>Consultar estado na Meta</button>}{action.error&&<p role="alert">{action.error}</p>}</section>;}
export function CampaignWorkspaceDetail({reviewProposalId,merchantId,row,overview,api,approval,onBack,onUpdated,onEdit,onSetup,onCorrectBudget,children,pollMs=5000}:CampaignWorkspaceDetailProps){
 const section=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),title=useId(),c=row.campaign;
 const [publication,setPublication]=useState<MetaAdsProposal|null>(null),publishAction=useAction(),publishKey=useRef<{version:string;key:string}|null>(null);
 useEffect(()=>{heading.current?.focus({preventScroll:true});section.current?.scrollIntoView?.({block:'start'});},[c.id]);
 const owned=c.createdByAgent&&c.managed&&c.lifecycle?.state!=='archived';
 const launches=overview.proposals.filter(p=>p.campaignId===c.id&&p.kind==='launch').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const selected=overview.proposals.find(p=>p.id===row.pendingProposalId),launch=selected?.kind==='launch'?selected:launches[0];
 const requested=overview.proposals.find(p=>p.id===reviewProposalId&&p.campaignId===c.id),requestedLaunchId=reviewProposalId&&(!requested||requested.kind==='launch')?reviewProposalId:undefined;
 const preparing=owned&&(!!requestedLaunchId||!c.remoteCampaignId||!!launch&&['pending_review','approved'].includes(launch.status));
 const executions=overview.executions.filter(e=>e.campaignId===c.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id)),latest=executions.find(e=>e.status===c.status)??executions[0];
 const revision=JSON.stringify([c.updatedAt,overview.connection.epoch,overview.media.filter(m=>m.campaignId===c.id).map(m=>m.id),overview.proposals.filter(p=>p.campaignId===c.id).map(p=>[p.id,p.status,p.executionId])]);
 const changes=[...overview.proposals,...(publication&&!overview.proposals.some(p=>p.id===publication.id)?[publication]:[])].filter(p=>p.campaignId===c.id&&p.kind!=='launch'&&['pending_review','approved'].includes(p.status));
 const pending=executions.some(e=>['reserved','sending','publishing','execution_unknown'].includes(e.status));
 const canReviewPublication=owned&&overview.entitled&&!preparing&&!!c.remoteCampaignId&&['remote_paused','remote_draft'].includes(c.status)&&!pending&&!changes.length;
 async function reviewPublication(){
  if(!canReviewPublication)return;
  const version=JSON.stringify([c.id,c.updatedAt,overview.connection.epoch]);
  if(publishKey.current?.version!==version)publishKey.current={version,key:crypto.randomUUID()};
  const proposal=await api.propose(c.id,{kind:'publish',after:{},reasoning:'Publicar a campanha com o anúncio e o investimento revisados.',idempotencyKey:publishKey.current.key});
  setPublication(proposal);await onUpdated();
 }
 return <section ref={section} className={`ads-detail dashboard-ui${c.remoteCampaignId?' ads-detail--published':''}`} aria-labelledby={title}>
  <button type="button" className="zyn-btn zyn-btn--ghost ads-detail__back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/>Voltar às campanhas</button>
  <header className="ads-detail__heading"><div><h2 id={title} ref={heading} tabIndex={-1}>{c.draft.name}</h2><span className="ads-workspace__state" data-state={row.group}>{row.stateLabel}</span></div>{owned&&overview.entitled?<button type="button" className="zyn-btn zyn-btn--outline" onClick={onEdit}>Editar campanha</button>:null}</header>
  <div className="ads-detail__audience"><h3>Público da campanha</h3><p>{campaignAudience(row.audience)}</p>{row.audience.source!=='unavailable'?<small>{row.audience.source==='verified'?(row.audience.checkedAt?`Confirmado na Meta em ${new Date(row.audience.checkedAt).toLocaleDateString('pt-BR')}.`:'Confirmado na Meta.'):'Planejado para este anúncio. A configuração é conferida antes da publicação.'}</small>:null}</div>
  {c.opportunity?<aside className="ads-detail__opportunity"><h3>Por que a Zyon escolheu este produto</h3><p>{c.opportunity.reason}</p></aside>:null}
  {owned&&!preparing&&overview.entitled&&latest&&['sending','execution_unknown','publishing','active_unconfirmed','remote_draft'].includes(latest.status)?<ExecutionReadback key={`${latest.id}:${latest.updatedAt}`} execution={latest} api={api} onUpdated={onUpdated}/>:null}
  {preparing?<CampaignPreparationPanel showHeading={false} merchantId={merchantId} campaignId={c.id} proposalId={requestedLaunchId??launch?.id} hasLaunch={!!requestedLaunchId||!!launch} refreshRevision={revision} api={approval} entitled={overview.entitled} pollMs={pollMs} timezone={row.metrics?.timezone} onUpdated={onUpdated} onReconcile={id=>api.reconcile(id)} campaign={c} media={overview.media} connection={overview.connection} onSetup={onSetup} onCorrectBudget={onCorrectBudget??onEdit}/>:c.createdByAgent?<DraftCampaignPreview showAudience={!c.remoteCampaignId} showHeading={false} key={c.id} campaign={c} media={overview.media} timezone={row.metrics?.timezone}/>:<p>O conteúdo desta campanha externa não está disponível para edição.</p>}
  {canReviewPublication?<div className="mga-actions"><button type="button" disabled={publishAction.busy} onClick={()=>void publishAction.run(reviewPublication,'Confira o anúncio e o investimento antes de publicar.')}>{publishAction.busy?'Carregando revisão…':'Revisar publicação'}</button></div>:null}
  {publishAction.error&&<p role="alert">{publishAction.error}</p>}
  {owned?changes.map(p=><section className="ads-detail__change" key={p.id}><h3>{p.kind==='publish'?'Publicar campanha':'Alteração para revisar'}</h3><ProposalReview publishOnApproval={p.kind==='publish'} proposal={p} execution={overview.executions.find(e=>e.proposalId===p.id)} entitled={overview.entitled} connectionEpoch={overview.connection.epoch} api={api} onUpdated={onUpdated}/></section>):null}
  {children}
 </section>;
}
