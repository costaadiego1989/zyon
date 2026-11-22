import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssistantArtifact, AssistantThread, AssistantTurn, AssistantTurnInput, MetaAdsAutomationReview, MetaAdsDailyReport, MetaAdsFundingDiagnosis, MetaAdsOverview } from '@zyon/shared-types';
import { merchantAssistantEndpoints, type AssistantSourceView, type AutomationView, type MerchantAssistantApi } from '../../api/endpoints/merchant-assistant.js';
import type { MetaAdsAgentApi } from '../../api/endpoints/meta-ads-agent.js';
import { ChatDock } from '../../components/merchant-assistant/ChatDock.js';
import { AutomationPolicyPanel } from './AutomationPolicyPanel.js';
import { CampaignChatArtifact } from './CampaignChatArtifact.js';
import { DailyReportArtifact } from './DailyReportArtifact.js';
import { FundingPanel } from './FundingPanel.js';
import { MetricsDashboard } from './MetricsDashboard.js';
import { ProposalReview } from './ProposalReview.js';
import { DashboardHttpError } from '../../api/http/error.js';
import { Bell,Image,Link,RefreshCw,SlidersHorizontal,Wallet } from 'lucide-react';
import {TabBar} from '../../components/TabBar.js';
import {campaignApprovalEndpoints,type CampaignApprovalApi} from './api.js';
import {CampaignNoticePreferences} from './CampaignNoticePreferences.js';
import {CampaignPreparationPanel} from './CampaignPreparationPanel.js';
import type {CampaignReviewTarget} from '../../components/notification-inbox.js';
import {adsAssistantHints} from './assistant-guide.js';
import {ZyonAgentOrb} from '../../components/merchant-assistant/ZyonAgentOrb.js';
import {useAction} from './presentation.js';
import {campaignChoices} from './campaign-choices.js';
import {MetaConnectionBadge} from './MetaConnectionBadge.js';
import {AutomaticPreparationSettings} from './AutomaticPreparationSettings.js';
export interface CampaignWorkspaceOpenTarget {campaignId:string;proposalId?:string;source:'chat'|'notification'|'report';}

export interface MetaAdsAssistantProps {
  merchantId:string; apiBaseUrl:string; overview:MetaAdsOverview; api:MetaAdsAgentApi;
  client?:MerchantAssistantApi; pollMs?:number; children?:ReactNode; settings?:ReactNode; billingSettings?:ReactNode;
  onUpdated:()=>void|Promise<void>; onModeChanged?:(mode:'manual'|'automatic'|'unknown')=>void;
  startRequest?:number;setupRequest?:number;
  onOpenCampaign?:(target:CampaignWorkspaceOpenTarget)=>void;
  approvalClient?:CampaignApprovalApi;selectedCampaignId?:string|null;reviewTarget?:CampaignReviewTarget;
}
const noHints:readonly string[]=[];
const fields:Record<string,string>={priority:'Resultado desejado',variantIds:'Produto ou categoria',destination:'Loja ou WhatsApp',budget:'Orçamento',country:'Região'};
const terminal=(turn:AssistantTurn)=>!['queued','running'].includes(turn.status);
function mergeThread(previous:AssistantThread|null,next:AssistantThread):AssistantThread {
  if(!previous||previous.id!==next.id)return next;
  const turns=new Map(previous.turns.map(turn=>[turn.id,turn]));
  for(const turn of next.turns){const old=turns.get(turn.id);if(!old||!terminal(old)||terminal(turn)&&turn.updatedAt>=old.updatedAt)turns.set(turn.id,turn);}
  return {...(next.revision>=previous.revision?next:previous),turns:[...turns.values()].sort((a,b)=>a.ordinal-b.ordinal)};
}
const https=(value:string)=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
export function MetaAdsAssistant(props:MetaAdsAssistantProps){return <MetaAdsAssistantView key={`${props.merchantId}:${props.apiBaseUrl}`} {...props}/>;}
function MetaAdsAssistantView({merchantId,apiBaseUrl,overview,api,client:supplied,pollMs=2500,children,settings,billingSettings,onUpdated,onModeChanged,startRequest=0,approvalClient,selectedCampaignId,reviewTarget,onOpenCampaign,setupRequest=0}:MetaAdsAssistantProps) {
  const feedback=useAction();
  const externalOpen=useRef(onOpenCampaign);externalOpen.current=onOpenCampaign;
  const [limitsVisited,setLimitsVisited]=useState(false);
  const approval=useMemo(()=>approvalClient??campaignApprovalEndpoints(apiBaseUrl),[apiBaseUrl,approvalClient]);
  useEffect(()=>()=>approval.dispose(),[approval]);
  const workspace=useRef<HTMLDivElement>(null);
  const reviewAnchor=useRef<HTMLDivElement>(null);
  const panelId=useId();
  const [reviewPending,setReviewPending]=useState(false);
  const [view,setView]=useState<'campaigns'|'metrics'|'settings'>(()=>overview.connection.account&&overview.connection.page&&(overview.connection.dataset||overview.connection.whatsapp)?'campaigns':'settings');
  const client=useRef<MerchantAssistantApi|null>(null),lifetime=useRef<AbortController|null>(null),alive=useRef(false),sequence=useRef(0),sendLock=useRef(false);
  const panelReads=useRef({funding:0,automation:0,reports:0});
  const threadRef=useRef<AssistantThread|null>(null),pending=useRef<AssistantTurnInput|null>(null),keys=useRef(new Map<string,string>()),updated=useRef(onUpdated);updated.current=onUpdated;
  const [thread,setThread]=useState<AssistantThread|null>(null),[loading,setLoading]=useState(true),[chatError,setChatError]=useState(''),[submitting,setSubmitting]=useState(false);
  const [funding,setFunding]=useState<MetaAdsFundingDiagnosis|null>(null),[fundingError,setFundingError]=useState(''),[automation,setAutomation]=useState<AutomationView|null>(null),[policyError,setPolicyError]=useState(''),[reports,setReports]=useState<MetaAdsDailyReport[]>([]),[reportId,setReportId]=useState(''),[reportError,setReportError]=useState('');
  const [source,setSource]=useState<AssistantSourceView|null>(null),[sourceError,setSourceError]=useState(''),[focusedProposal,setFocusedProposal]=useState('');
  const [focusedCampaign,setFocusedCampaign]=useState('');
  useEffect(()=>{setFocusedCampaign('');setFocusedProposal('');},[selectedCampaignId]);
  const [expanded,setExpanded]=useState(false);
  const [settingsView,setSettingsView]=useState<'connection'|'funding'|'automation'|'notices'|'plan'>('connection');
  const proposalHeading=useRef<HTMLHeadingElement>(null),policyHeading=useRef<HTMLDivElement>(null),fundingHeading=useRef<HTMLDivElement>(null),sourceHeading=useRef<HTMLHeadingElement>(null);
  const identity=(intent:string)=>{if(!keys.current.has(intent))keys.current.set(intent,crypto.randomUUID());return keys.current.get(intent)!;};
  const apply=useCallback((value:AssistantThread)=>{if(!alive.current)return;setThread(previous=>{const next=mergeThread(previous,value);threadRef.current=next;return next;});},[]);
  const loadChat=useCallback(async(throwOnError=false)=>{
    const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)return;const request=++sequence.current;
    try{const value=await port.thread('meta-ads',signal);if(alive.current&&request===sequence.current){apply(value);setChatError('');}}
    catch(error){if(alive.current&&!signal.aborted){setChatError('Não foi possível carregar a conversa. Atualize para retomar o histórico.');if(throwOnError)throw error;}}
    finally{if(alive.current&&!signal.aborted)setLoading(false);}
  },[apply]);
  const loadPanels=useCallback(async()=>{
    const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)return;
    const version={funding:++panelReads.current.funding,automation:++panelReads.current.automation,reports:++panelReads.current.reports};
    const results=await Promise.allSettled([port.funding(signal),port.automation(signal),port.reports(signal)]);
    if(!alive.current||signal.aborted)return;
    const [f,p,r]=results;
    if(version.funding===panelReads.current.funding){if(f.status==='fulfilled'){setFunding(f.value);setFundingError('');}else setFundingError('Não foi possível consultar os pagamentos. Nenhum saldo foi presumido.');}
    if(version.automation===panelReads.current.automation){if(p.status==='fulfilled'){setAutomation(p.value);setPolicyError('');}else setPolicyError('Não foi possível confirmar a política atual. Novas autorizações precisam ser verificadas.');}
    if(version.reports===panelReads.current.reports){if(r.status==='fulfilled'){setReports(r.value.reports);setReportId(current=>r.value.reports.some(report=>report.id===current)?current:r.value.reports[0]?.id??'');setReportError('');}else setReportError('Não foi possível carregar os relatórios diários.');}
  },[]);
  useEffect(()=>{
    const port=supplied??merchantAssistantEndpoints(apiBaseUrl),controller=new AbortController();client.current=port;lifetime.current=controller;alive.current=true;
    void loadChat();void loadPanels();
    return()=>{alive.current=false;controller.abort();port.dispose();client.current=null;lifetime.current=null;};
  },[apiBaseUrl,supplied,loadChat,loadPanels]);
  useEffect(()=>{onModeChanged?.(policyError||!automation?'unknown':automation.mode);},[automation?.mode,policyError,onModeChanged]);
  useEffect(()=>{if(source){setExpanded(false);sourceHeading.current?.focus();}},[source]);
  const processing=!!thread?.turns.some(turn=>!terminal(turn));
  const observedPending=useRef(new Set<string>());
  const announcedFailures=useRef(new Set<string>());
  function reportTurnFailure(turn:AssistantTurn){if(!['failed','unknown'].includes(turn.status)||announcedFailures.current.has(turn.id))return;announcedFailures.current.add(turn.id);feedback.notify('error',turn.status==='unknown'?'A IA não confirmou o resultado. Consulte a conversa antes de tentar novamente.':'A IA não concluiu a solicitação. Confira a conversa para retomar.');}
  useEffect(()=>{
    let completed=false;for(const turn of thread?.turns??[]){if(!terminal(turn))observedPending.current.add(turn.id);else if(observedPending.current.delete(turn.id)){completed=true;reportTurnFailure(turn);}}
    if(completed)void Promise.allSettled([loadPanels(),Promise.resolve(updated.current())]);
  },[thread,loadPanels]);
  const pendingWork=overview.generations.some(job=>['reserved','running'].includes(job.status))||overview.executions.some(job=>['reserved','sending','publishing'].includes(job.status));
  useEffect(()=>{if(!pendingWork)return;let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{await updated.current();}catch{/* Keep the last confirmed operation visible. */}if(!cancelled)timer=setTimeout(poll,pollMs);};timer=setTimeout(poll,pollMs);return()=>{cancelled=true;clearTimeout(timer);};
  },[pendingWork,pollMs]);
  useEffect(()=>{if(!processing)return;let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    const delay=expanded?Math.min(pollMs,1000):pollMs;const poll=async()=>{await loadChat();if(!cancelled)timer=setTimeout(poll,delay);};timer=setTimeout(poll,delay);return()=>{cancelled=true;clearTimeout(timer);};
  },[processing,pollMs,loadChat,expanded]);
  useEffect(()=>{const timer=setInterval(()=>{const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)return;const request=++panelReads.current.reports;void port.reports(signal).then(value=>{if(alive.current&&!signal.aborted&&request===panelReads.current.reports){setReports(value.reports);setReportId(current=>current||value.reports[0]?.id||'');}}).catch(()=>{/* Existing report retains its timestamp. */});},60000);return()=>clearInterval(timer);},[]);
  async function admit(input:AssistantTurnInput){
    if(sendLock.current||!client.current||!lifetime.current||!threadRef.current)throw new Error('assistant_not_ready');
    sendLock.current=true;setSubmitting(true);const port=client.current,signal=lifetime.current.signal;
    try{const result=await port.submit('meta-ads',threadRef.current.id,input,signal);if(!alive.current||signal.aborted)throw new DOMException('Contexto encerrado','AbortError');
      reportTurnFailure(result.turn);
      apply({...threadRef.current,revision:result.revision,turns:[result.turn]});pending.current=null;setChatError('');
      void Promise.resolve(updated.current()).catch(()=>{});
    }catch(error){if(alive.current&&!signal.aborted){let conflict=false;
      if(error instanceof DashboardHttpError&&error.status===409){try{conflict=['assistant_revision_conflict','assistant_turn_pending'].includes(JSON.parse(error.responseBody).code);}catch{/* Public fallback below. */}}
      if(conflict){pending.current=null;await loadChat();if(alive.current&&!signal.aborted)setChatError('A conversa mudou em outra sessão. O histórico foi atualizado; revise sua mensagem antes de enviar novamente.');}
      else setChatError('Não foi possível confirmar o envio. Retome a mesma mensagem para consultar ou concluir o turno sem duplicá-lo.');
      feedback.notify('error',conflict?'A conversa mudou. Revise o histórico antes de enviar novamente.':'Não foi possível confirmar o envio. Retome a mesma mensagem sem duplicá-la.');
    }throw error;}
    finally{sendLock.current=false;if(alive.current&&!signal.aborted)setSubmitting(false);}
  }
  async function send(message:string){
    if(processing)throw new Error('assistant_turn_in_progress');
    if(pending.current&&pending.current.message!==message)throw new Error('assistant_pending_retry');
    const input=pending.current??{message,idempotencyKey:crypto.randomUUID(),expectedRevision:threadRef.current?.revision??0};pending.current=input;await admit(input);
  }
  async function retry(){if(pending.current)await admit(pending.current);else await feedback.run(()=>loadChat(true),'Conversa atualizada.');}
  async function refresh(){await loadChat();await loadPanels();await updated.current();}
  async function refreshReports(){const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)throw new Error('context_ended');const request=++panelReads.current.reports;const value=await port.reports(signal);if(alive.current&&!signal.aborted&&request===panelReads.current.reports){setReports(value.reports);setReportId(current=>value.reports.some(report=>report.id===current)?current:value.reports[0]?.id??'');setReportError('');}}
  async function openSource(id:string){setSourceError('');const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)return;try{const value=await port.source('meta-ads',id,signal);if(alive.current&&!signal.aborted)setSource(value);}catch{if(alive.current&&!signal.aborted){const message='Esta fonte não está disponível na versão atual. A referência histórica permanece identificada.';setSourceError(message);feedback.notify('error',message);}}}
  async function accept(review:MetaAdsAutomationReview){const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)throw new Error('context_ended');const value=await port.acceptAutomation({scope:review.scope,limits:review.limits,version:review.version,digest:review.digest,idempotencyKey:identity(`accept:${review.digest}`)},signal);if(alive.current&&!signal.aborted){panelReads.current.automation++;setAutomation({...value,version:review.version});setPolicyError('');}}
  async function manual(){const port=client.current,signal=lifetime.current?.signal,policy=automation?.policy;if(!port||!signal||!policy)throw new Error('policy_unavailable');const value=await port.manual({policyId:policy.id,version:policy.version,idempotencyKey:identity(`revoke:${policy.id}:${policy.version}`)},signal);if(alive.current&&!signal.aborted){panelReads.current.automation++;setAutomation({...value,version:(automation?.version??policy.version)+1});setPolicyError('');}}
  const account=overview.connection.account;
  const latestReview=thread?.turns.flatMap(turn=>turn.artifacts).filter((artifact):artifact is Extract<AssistantArtifact,{type:'automation_review'}>=>artifact.type==='automation_review').at(-1)?.review;
  const review=latestReview&&latestReview.accountId===account?.id&&latestReview.digest!==automation?.policy?.digest?latestReview:null;
  const campaignNames=Object.fromEntries(overview.campaigns.map(c=>[c.id,c.draft.name])),productNames=Object.fromEntries([...(thread?.campaign?.automationBriefing?.selection?.productOptions??[]).map(p=>[p.variantId,p.name]),...overview.campaigns.flatMap(c=>c.products).map(p=>[p.variantId,p.name])]);
  const chosenReport=reports.find(report=>report.id===reportId);
  const nextField=['destination','variantIds','priority','budget','country'].find(field=>thread?.campaign?.awaitingFields.includes(field));
  async function configureAutonomy(){setExpanded(true);if(processing||submitting||pending.current)return;try{await send('Quero configurar o modo automático. Me conduza uma pergunta de cada vez para escolher os produtos, as campanhas, as ações e os limites de verba. Explique cada escolha e apresente a política para meu aceite. Toda campanha nova continua exigindo aprovação.');}catch{/* The chat keeps the request and its recovery message. */}}
  const policyProps={accountId:account?.id??null,state:automation,review,productNames,campaignNames,disabled:!overview.entitled||loading||submitting||!!policyError,error:policyError,onChooseAutomatic:configureAutonomy,onRetry:loadPanels,onAccept:accept,onManual:manual};
  function navigateOutside(target:HTMLElement|null){if(target===policyHeading.current)setLimitsVisited(true);setView('settings');setSettingsView(target===policyHeading.current?'automation':'funding');setExpanded(false);setTimeout(()=>target?.focus(),0);}
  function reviewProposal(id:string,campaignId?:string,source:'chat'|'report'='chat'){setView('campaigns');if(campaignId&&externalOpen.current){setExpanded(false);externalOpen.current({campaignId,proposalId:id,source});return;}setFocusedProposal(id);if(campaignId)setFocusedCampaign(campaignId);setExpanded(false);setTimeout(()=>{reviewAnchor.current?.scrollIntoView?.({block:'start',behavior:'auto'});reviewAnchor.current?.focus({preventScroll:true});},0);}
  function openCampaignReview(id:string){if(externalOpen.current){setView('campaigns');setExpanded(false);externalOpen.current({campaignId:id,source:'chat'});return;}setFocusedCampaign(id);setFocusedProposal('');setView('campaigns');setExpanded(false);setTimeout(()=>{reviewAnchor.current?.scrollIntoView?.({block:'start',behavior:'auto'});reviewAnchor.current?.focus({preventScroll:true});},0);}
  function openConnection(){setView('settings');setSettingsView('connection');setExpanded(false);setTimeout(()=>{const target=workspace.current?.querySelector<HTMLElement>('[aria-labelledby="mga-whatsapp-title"]')??workspace.current?.querySelector<HTMLElement>('[data-settings-section="connection"]');target?.scrollIntoView?.({block:'start'});},0);}
  useEffect(()=>{if(reviewTarget?.merchantId===merchantId){if(externalOpen.current){setView('campaigns');setExpanded(false);externalOpen.current({campaignId:reviewTarget.campaignId,proposalId:reviewTarget.proposalId,source:'notification'});return;}setView('campaigns');setFocusedCampaign(reviewTarget.campaignId);setFocusedProposal(reviewTarget.proposalId);setExpanded(false);}},[reviewTarget?.merchantId,reviewTarget?.campaignId,reviewTarget?.proposalId,merchantId]);
  useEffect(()=>{if(startRequest)setExpanded(true);},[startRequest]);
  useEffect(()=>{if(startRequest&&expanded)workspace.current?.querySelector<HTMLTextAreaElement>('.chat-dock-composer textarea')?.focus();},[startRequest,expanded]);
  function artifact(value:AssistantArtifact,index:number):ReactNode {
    switch(value.type){
      case 'campaign':{const current=overview.campaigns.find(c=>c.id===value.campaign.id);return <CampaignChatArtifact key={`campaign-${value.campaign.id}`} campaign={current??{...value.campaign,managed:false}} overview={overview} api={api} busy={processing||submitting} onUpdated={refresh} onRequest={send} onReview={()=>openCampaignReview(value.campaign.id)}/>;}
      case 'campaign_progress':return null;
      case 'generation':{const current=overview.generations.find(g=>g.id===value.generation.id)??value.generation;return <p key={index}>Geração: {current.status==='unknown'?'resultado desconhecido, sem repetição automática':current.status==='succeeded'?'concluída':current.status==='reserved'?'na fila':current.status==='running'?'em andamento':current.status==='partial'?'parcial':'falha confirmada'} · {current.mediaIds.length}/{current.requestedImages} imagens.</p>;}
      case 'proposal':{const current=overview.proposals.find(p=>p.id===value.proposal.id);if(value.proposal.kind==='launch')return <p key={value.proposal.id}>Campanha pronta para aprovação. <button type="button" className="mga-secondary" onClick={()=>reviewProposal(value.proposal.id,value.proposal.campaignId)}>Revisar campanha</button></p>;return <ProposalReview key={value.proposal.id} proposal={current??value.proposal} execution={overview.executions.find(e=>e.proposalId===value.proposal.id)??value.execution??undefined} entitled={overview.entitled&&!!current} connectionEpoch={overview.connection.epoch} api={api} onUpdated={refresh}/>;}
      case 'funding':return <div key={index}><p>Consulta registrada nesta resposta: {value.diagnosis.message}</p>{value.diagnosis.snapshot&&<small>Conta {value.diagnosis.snapshot.accountId} · <time dateTime={value.diagnosis.snapshot.checkedAt}>{new Date(value.diagnosis.snapshot.checkedAt).toLocaleString('pt-BR',{timeZoneName:'short'})}</time> · Dados consultados na Meta</small>}<button type="button" className="mga-secondary" onClick={()=>navigateOutside(fundingHeading.current)}>Ver pagamentos atuais</button></div>;
      case 'automation_review':return <p key={index}>Política preparada para revisão. <button type="button" className="mga-secondary" onClick={()=>navigateOutside(policyHeading.current)}>Revisar política</button></p>;
      case 'automation':return <p key={index}>Consulte o modo efetivo e a política atual em Autonomia da IA.</p>;
      case 'daily_report':return <DailyReportArtifact key={value.report.id} report={reports.find(r=>r.id===value.report.id)??value.report} campaignNames={campaignNames} onReview={(id,campaignId)=>reviewProposal(id,campaignId,'report')}/>;
      case 'campaign_status':return <p key={index}>Conta {value.snapshot.accountId} · Estado configurado: {value.snapshot.configuredStatus} · Estado efetivo: {value.snapshot.effectiveStatus} · Consulta em <time dateTime={value.snapshot.checkedAt}>{new Date(value.snapshot.checkedAt).toLocaleString('pt-BR',{timeZoneName:'short'})}</time>. A configuração não confirma veiculação nem vendas.</p>;
    }
  }
  function details(turn:AssistantTurn){return <>{turn.artifacts.map(artifact)}{!!turn.references.length&&<details className="mga-chat-references"><summary>Fontes consultadas <span>{turn.references.length}</span></summary><ul>{turn.references.map(reference=><li key={`${reference.id}:${reference.version}`}><button type="button" className="mga-secondary" onClick={()=>void openSource(reference.id)}>Ver fonte: {reference.title.trim()||'Orientação consultada'}</button><small>Revisada em {reference.reviewedAt.split('-').reverse().join('/')} · Versão {reference.version}</small></li>)}</ul></details>}</>;}
  const proposal=overview.proposals.find(p=>p.id===focusedProposal);
  useEffect(()=>{if(setupRequest>0)openConnection();},[setupRequest]);
  const foreignTarget=!!reviewTarget&&reviewTarget.merchantId!==merchantId;
  const campaignId=foreignTarget?null:focusedCampaign||selectedCampaignId||reviewTarget?.campaignId||thread?.campaign?.campaignId;
  const activeCampaignId=campaignId||selectedCampaignId||thread?.campaign?.campaignId;
  const initialCampaign=activeCampaignId?overview.campaigns.find(c=>c.id===activeCampaignId):null;
  const preparationRevision=thread?.turns.filter(terminal).map(turn=>`${turn.id}:${turn.status}:${turn.updatedAt}`).join('|')??'';
  const latestLaunch=overview.proposals.filter(p=>p.kind==='launch'&&p.campaignId===activeCampaignId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0];
  const launchId=(reviewTarget&&reviewTarget.campaignId===activeCampaignId?reviewTarget.proposalId:undefined)||(proposal?.kind==='launch'&&proposal.campaignId===activeCampaignId?proposal.id:undefined);
  return <div className="mga-agentic-shell" ref={workspace}><div className="mga-agentic-content">
    <div className="mga-account-context"><span className="mga-account-name" title={account?`Conta ${account.id}`:undefined}>{account?.name??'Selecione sua conta Meta'}</span><MetaConnectionBadge status={overview.connection.status}/></div>
    <div className="mga-workspace-tabs"><TabBar tabs={[{key:'campaigns',label:'Campanhas',panelId:`${panelId}-campaigns`},{key:'metrics',label:'Métricas',panelId:`${panelId}-metrics`},{key:'settings',label:'Configurações',panelId:`${panelId}-settings`}]} activeTab={view} onTabChange={key=>setView(key as typeof view)} label="Seções de anúncios"/></div>
    {funding?.status==='blocked'&&view!=='settings'&&<div className="mga-notice" role="alert">Publicação bloqueada por uma pendência financeira. <button type="button" className="mga-secondary" onClick={()=>navigateOutside(fundingHeading.current)}>Ver pagamentos atuais</button></div>}
    <div role="tabpanel" id={`${panelId}-campaigns`} aria-labelledby={`${panelId}-campaigns-tab`} data-assistant-panel="campaigns" hidden={view!=='campaigns'}>{children}
      {foreignTarget?<p role="alert">Esta revisão pertence a outra loja. Selecione a loja correta.</p>:!onOpenCampaign&&activeCampaignId&&(!initialCampaign?.remoteCampaignId||launchId||latestLaunch)?<div ref={reviewAnchor} tabIndex={-1} data-campaign-review><CampaignPreparationPanel merchantId={merchantId} campaignId={activeCampaignId} proposalId={launchId} hasLaunch={!!latestLaunch} refreshRevision={preparationRevision} onReviewPendingChange={setReviewPending} api={approval} entitled={overview.entitled} selectedImageCount={initialCampaign?.draft.mediaIds.length??0} pollMs={pollMs} timezone={reports.find(r=>r.accountId===account?.id)?.timezone} onUpdated={refresh} onReconcile={id=>api.reconcile(id)} campaign={initialCampaign} media={overview.media} connection={overview.connection} onSetup={openConnection} onCorrectBudget={()=>{setExpanded(true);void send(`Quero corrigir o orçamento da campanha ${initialCampaign?.draft.name??'selecionada'}. Me ajude a ajustar o valor ou os dias, sem aumentar nada por conta própria.`).catch(()=>{});}}/></div>:null}
    </div>
    <div role="tabpanel" id={`${panelId}-metrics`} aria-labelledby={`${panelId}-metrics-tab`} data-assistant-panel="metrics" hidden={view!=='metrics'}>
      <MetricsDashboard key={account?.id??'disconnected'} reports={reports} accountId={account?.id??null} campaignNames={campaignNames} active={view==='metrics'} error={reportError} onRefresh={refreshReports} onSettings={()=>{setView('settings');setSettingsView('connection');setExpanded(false);setTimeout(()=>workspace.current?.querySelector<HTMLButtonElement>('.mga-settings-nav button')?.focus(),0);}}/>
      <details className="mga-setup mga-disclosure"><summary>Relatórios diários</summary>{reports.length?<><label>Dia do relatório<select aria-label="Dia do relatório" value={reportId} onChange={e=>setReportId(e.target.value)}>{reports.map(report=><option key={report.id} value={report.id}>{report.localDay.split('-').reverse().join('/')}</option>)}</select></label>{chosenReport&&<DailyReportArtifact report={chosenReport} campaignNames={campaignNames} onReview={reviewProposal}/>}</>:<p>Seus relatórios aparecem após o fechamento de cada dia.</p>}</details></div>
    <div className="mga-settings" role="tabpanel" id={`${panelId}-settings`} aria-labelledby={`${panelId}-settings-tab`} data-assistant-panel="settings" hidden={view!=='settings'}>
      <div className="mga-settings-layout"><nav className="mga-settings-nav" aria-label="Configurações dos anúncios">{([{key:'connection',label:'Conta Meta',Icon:Link},{key:'funding',label:'Verba',Icon:Wallet},{key:'automation',label:'Autonomia',Icon:SlidersHorizontal},{key:'notices',label:'Avisos',Icon:Bell},{key:'plan',label:'Plano e imagens',Icon:Image}] as const).map(({key,label,Icon})=><button key={key} type="button" aria-current={settingsView===key?'page':undefined} onClick={()=>{if(key==='automation')setLimitsVisited(true);setSettingsView(key);}}><Icon size={17} aria-hidden="true"/>{label}</button>)}</nav><div className="mga-settings-content">
      <div data-settings-section="connection" hidden={settingsView!=='connection'}>{settings}</div>
      <div data-settings-section="funding" hidden={settingsView!=='funding'} ref={fundingHeading} tabIndex={-1}><FundingPanel compact account={account} diagnosis={funding} error={fundingError} onRefresh={async()=>{const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)return;const request=++panelReads.current.funding;const value=await port.refreshFunding(signal);if(alive.current&&!signal.aborted&&request===panelReads.current.funding){setFunding(value);setFundingError('');}}}/></div>
      <div data-settings-section="automation" hidden={settingsView!=='automation'} ref={policyHeading} tabIndex={-1}><AutomationPolicyPanel {...policyProps}/>{limitsVisited&&<AutomaticPreparationSettings merchantId={merchantId} api={api} onFeedback={(type,message)=>feedback.notify(type,message)}/>}</div>
      <div data-settings-section="notices" hidden={settingsView!=='notices'}><CampaignNoticePreferences merchantId={merchantId} api={approval}/></div>
      <div data-settings-section="plan" hidden={settingsView!=='plan'}>{billingSettings}</div>
      </div></div>
    </div>
    {!onOpenCampaign&&proposal&&proposal.kind!=='launch'&&<section className="mga-panel"><h2 ref={proposalHeading} tabIndex={-1}>Proposta do relatório</h2><ProposalReview proposal={proposal} execution={overview.executions.find(e=>e.proposalId===proposal.id)} entitled={overview.entitled} connectionEpoch={overview.connection.epoch} api={api} onUpdated={refresh}/></section>}
    {sourceError&&<p role="alert">{sourceError}</p>}{source&&<section className="mga-panel" aria-label="Fonte da resposta"><h2 ref={sourceHeading} tabIndex={-1}>{source.title}</h2><small>Versão atual {source.version} · Revisada em {source.reviewedAt.split('-').reverse().join('/')}</small>{source.sections.map(section=><p key={section.id}>{section.content}</p>)}{source.externalSources.map(origin=>{const url=https(origin.url);return url?<p key={url}><a href={url} target="_blank" rel="noopener noreferrer">{origin.title}</a></p>:null;})}<button type="button" className="mga-secondary" onClick={()=>setSource(null)}>Fechar fonte</button></section>}
  </div><ChatDock presentation='floating' pageKey={`${merchantId}:${view}`} hints={view==='campaigns'&&(reviewPending||latestLaunch?.status==='pending_review')?noHints:adsAssistantHints[view]} choices={campaignChoices(thread)} expanded={expanded} onExpandedChange={setExpanded} context={{...(thread?.context??{id:'meta-ads',label:'Anúncios com IA',capabilities:[]}),label:view==='metrics'?'Métricas dos anúncios':view==='settings'?'Configurações dos anúncios':'Anúncios com IA'}} turns={thread?.turns??[]} loading={loading} busy={processing||submitting} disabled={!overview.entitled} error={chatError} onSend={send} onRetry={retry} renderTurnDetails={details}
    headerExtra={<div className="mga-chat-context"><button type="button" className="mga-secondary mga-chat-refresh" aria-label="Atualizar conversa" title="Atualizar conversa" disabled={submitting} onClick={()=>void feedback.run(async()=>{await loadChat(true);await loadPanels();await updated.current();},"Conversa atualizada.")}><RefreshCw size={15} aria-hidden="true"/><span className="mga-visually-hidden">Atualizar conversa</span></button>{thread?.campaign?.planningKind==='automation'?<p>Modo autônomo · produtos, ações e verba</p>:thread?.campaign?<p>{thread.campaign.draft.name??'Campanha da loja'} · {nextField?fields[nextField]:'planejamento completo'}</p>:<span>Planeje, tire dúvidas e acompanhe.</span>}{!overview.entitled&&<p>Histórico disponível. Novas mensagens exigem o adicional ativo.</p>}</div>}
    empty={<div className="mga-chat-welcome"><ZyonAgentOrb size={58}/><h3>{view==='metrics'?'Vamos entender seus resultados?':view==='settings'?'Vamos deixar tudo pronto?':'O que vamos anunciar?'}</h3><p>{view==='metrics'?'Eu explico os números em palavras simples e ajudo você a decidir o próximo passo.':view==='settings'?'Posso explicar o Pixel, o catálogo, os pagamentos e as aprovações.':'Não precisa entender de anúncios. Eu ajudo você a escolher, uma etapa por vez.'}</p><small>Exemplo: “Quero criar um anúncio dos meus produtos.”</small></div>}
    older={thread?.nextCursor&&<button type="button" className="mga-secondary" onClick={()=>{const port=client.current,signal=lifetime.current?.signal;if(!port||!signal||!thread.nextCursor)return;void port.page('meta-ads',thread.id,thread.nextCursor,signal).then(value=>{if(alive.current&&!signal.aborted){apply(value);feedback.notify('success','Mensagens anteriores carregadas.');}}).catch(()=>{if(alive.current&&!signal.aborted){const message='Não foi possível carregar as mensagens anteriores.';setChatError(message);feedback.notify('error',message);}});}}>Carregar mensagens anteriores</button>}/>
  </div>;
}
