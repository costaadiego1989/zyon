import {useEffect,useId,useRef,type ReactNode} from 'react';
import {ArrowLeft} from 'lucide-react';
import type {MetaAdsCampaignWorkspaceRow,MetaAdsOverview} from '@zyon/shared-types';
import type {MetaAdsAgentApi} from '../../api/endpoints/meta-ads-agent.js';
import type {CampaignApprovalApi} from './api.js';
import {CampaignPreparationPanel} from './CampaignPreparationPanel.js';
import {DraftCampaignPreview} from './DraftCampaignPreview.js';
import {ProposalReview} from './ProposalReview.js';
import {campaignAudience} from './CampaignWorkspace.js';
import './campaign-workspace.css';
export interface CampaignWorkspaceDetailProps {merchantId:string;row:MetaAdsCampaignWorkspaceRow;overview:MetaAdsOverview;api:MetaAdsAgentApi;approval:CampaignApprovalApi;onBack():void;onUpdated():void|Promise<void>;onEdit():void;onSetup():void;onCorrectBudget?():void;children?:ReactNode;pollMs?:number}
export function CampaignWorkspaceDetail({merchantId,row,overview,api,approval,onBack,onUpdated,onEdit,onSetup,onCorrectBudget,children,pollMs=5000}:CampaignWorkspaceDetailProps){
 const section=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),title=useId(),c=row.campaign;
 useEffect(()=>{heading.current?.focus({preventScroll:true});section.current?.scrollIntoView?.({block:'start'});},[c.id]);
 const owned=c.createdByAgent&&c.managed&&c.lifecycle?.state!=='archived';
 const launches=overview.proposals.filter(p=>p.campaignId===c.id&&p.kind==='launch').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const selected=overview.proposals.find(p=>p.id===row.pendingProposalId),launch=selected?.kind==='launch'?selected:launches[0];
 const preparing=owned&&(!c.remoteCampaignId||!!launch&&['pending_review','approved'].includes(launch.status));
 const revision=JSON.stringify([c.updatedAt,overview.connection.epoch,overview.media.filter(m=>m.campaignId===c.id).map(m=>m.id),overview.proposals.filter(p=>p.campaignId===c.id).map(p=>[p.id,p.status,p.executionId])]);
 return <section ref={section} className={`ads-detail dashboard-ui${c.remoteCampaignId?' ads-detail--published':''}`} aria-labelledby={title}>
  <button type="button" className="zyn-btn zyn-btn--ghost ads-detail__back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/>Voltar às campanhas</button>
  <header className="ads-detail__heading"><div><h2 id={title} ref={heading} tabIndex={-1}>{c.draft.name}</h2><span className="ads-workspace__state" data-state={row.group}>{row.stateLabel}</span></div>{owned&&overview.entitled?<button type="button" className="zyn-btn zyn-btn--outline" onClick={onEdit}>Editar campanha</button>:null}</header>
  <div className="ads-detail__audience"><h3>Público da campanha</h3><p>{campaignAudience(row.audience)}</p>{row.audience.source!=='unavailable'?<small>{row.audience.source==='verified'?(row.audience.checkedAt?`Confirmado na Meta em ${new Date(row.audience.checkedAt).toLocaleDateString('pt-BR')}.`:'Confirmado na Meta.'):'Planejado para este anúncio. A configuração é conferida antes da publicação.'}</small>:null}</div>
  {c.opportunity?<aside className="ads-detail__opportunity"><h3>Por que a Zyon escolheu este produto</h3><p>{c.opportunity.reason}</p></aside>:null}
  {preparing?<CampaignPreparationPanel showHeading={false} merchantId={merchantId} campaignId={c.id} proposalId={launch?.id} hasLaunch={!!launch} refreshRevision={revision} api={approval} entitled={overview.entitled} pollMs={pollMs} timezone={row.metrics?.timezone} onUpdated={onUpdated} onReconcile={id=>api.reconcile(id)} campaign={c} media={overview.media} connection={overview.connection} onSetup={onSetup} onCorrectBudget={onCorrectBudget??onEdit}/>:c.createdByAgent?<DraftCampaignPreview showAudience={!c.remoteCampaignId} showHeading={false} key={c.id} campaign={c} media={overview.media} timezone={row.metrics?.timezone}/>:<p>O conteúdo desta campanha externa não está disponível para edição.</p>}
  {owned?overview.proposals.filter(p=>p.campaignId===c.id&&p.kind!=='launch'&&['pending_review','approved'].includes(p.status)).map(p=><section className="ads-detail__change" key={p.id}><h3>Alteração para revisar</h3><ProposalReview proposal={p} execution={overview.executions.find(e=>e.proposalId===p.id)} entitled={overview.entitled} connectionEpoch={overview.connection.epoch} api={api} onUpdated={onUpdated}/></section>):null}
  {children}
 </section>;
}
