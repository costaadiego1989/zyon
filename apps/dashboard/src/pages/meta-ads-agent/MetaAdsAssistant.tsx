import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AssistantArtifact, AssistantThread, AssistantTurn, AssistantTurnInput, MetaAdsAutomationReview, MetaAdsDailyReport, MetaAdsFundingDiagnosis, MetaAdsOverview } from '@zyon/shared-types';
import { merchantAssistantEndpoints, type AssistantSourceView, type AutomationView, type MerchantAssistantApi } from '../../api/endpoints/merchant-assistant.js';
import type { MetaAdsAgentApi } from '../../api/endpoints/meta-ads-agent.js';
import { ChatDock } from '../../components/merchant-assistant/ChatDock.js';
import { AutomationPolicyPanel } from './AutomationPolicyPanel.js';
import { CampaignChatArtifact } from './CampaignChatArtifact.js';
import { DailyReportArtifact } from './DailyReportArtifact.js';
import { FundingPanel } from './FundingPanel.js';
import { ProposalReview } from './ProposalReview.js';
import { DashboardHttpError } from '../../api/http/error.js';

export interface MetaAdsAssistantProps {
  merchantId:string; apiBaseUrl:string; overview:MetaAdsOverview; api:MetaAdsAgentApi;
  client?:MerchantAssistantApi; pollMs?:number; children?:ReactNode;
  onUpdated:()=>void|Promise<void>; onModeChanged?:(mode:'manual'|'automatic'|'unknown')=>void;
}
const fields:Record<string,string>={priority:'Prioridade',variantIds:'Produtos',destination:'Destino',budget:'Orçamento',country:'Região',approvalPreference:'Aprovação'};
const terminal=(turn:AssistantTurn)=>!['queued','running'].includes(turn.status);
function mergeThread(previous:AssistantThread|null,next:AssistantThread):AssistantThread {
  if(!previous||previous.id!==next.id)return next;
  const turns=new Map(previous.turns.map(turn=>[turn.id,turn]));
  for(const turn of next.turns){const old=turns.get(turn.id);if(!old||!terminal(old)||terminal(turn)&&turn.updatedAt>=old.updatedAt)turns.set(turn.id,turn);}
  return {...(next.revision>=previous.revision?next:previous),turns:[...turns.values()].sort((a,b)=>a.ordinal-b.ordinal)};
}
const https=(value:string)=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const compact=()=>typeof window!=='undefined'&&(typeof matchMedia==='function'?matchMedia('(max-width: 900px)').matches:window.innerWidth<=900);
export function MetaAdsAssistant(props:MetaAdsAssistantProps){return <MetaAdsAssistantView key={`${props.merchantId}:${props.apiBaseUrl}`} {...props}/>;}
function MetaAdsAssistantView({apiBaseUrl,overview,api,client:supplied,pollMs=2500,children,onUpdated,onModeChanged}:MetaAdsAssistantProps) {
  const client=useRef<MerchantAssistantApi|null>(null),lifetime=useRef<AbortController|null>(null),alive=useRef(false),sequence=useRef(0),sendLock=useRef(false);
  const threadRef=useRef<AssistantThread|null>(null),pending=useRef<AssistantTurnInput|null>(null),keys=useRef(new Map<string,string>()),updated=useRef(onUpdated);updated.current=onUpdated;
  const [thread,setThread]=useState<AssistantThread|null>(null),[loading,setLoading]=useState(true),[chatError,setChatError]=useState(''),[submitting,setSubmitting]=useState(false);
  const [funding,setFunding]=useState<MetaAdsFundingDiagnosis|null>(null),[fundingError,setFundingError]=useState(''),[automation,setAutomation]=useState<AutomationView|null>(null),[policyError,setPolicyError]=useState(''),[reports,setReports]=useState<MetaAdsDailyReport[]>([]),[reportId,setReportId]=useState(''),[reportError,setReportError]=useState('');
  const [source,setSource]=useState<AssistantSourceView|null>(null),[sourceError,setSourceError]=useState(''),[focusedProposal,setFocusedProposal]=useState('');
  const [expanded,setExpanded]=useState(()=>!compact());
  const proposalHeading=useRef<HTMLHeadingElement>(null),policyHeading=useRef<HTMLDivElement>(null),fundingHeading=useRef<HTMLDivElement>(null),sourceHeading=useRef<HTMLHeadingElement>(null);
  const identity=(intent:string)=>{if(!keys.current.has(intent))keys.current.set(intent,crypto.randomUUID());return keys.current.get(intent)!;};
  const apply=useCallback((value:AssistantThread)=>{if(!alive.current)return;setThread(previous=>{const next=mergeThread(previous,value);threadRef.current=next;return next;});},[]);
  const loadChat=useCallback(async()=>{
    const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)return;const request=++sequence.current;
    try{const value=await port.thread('meta-ads',signal);if(alive.current&&request===sequence.current){apply(value);setChatError('');}}
    catch{if(alive.current&&!signal.aborted)setChatError('Não foi possível carregar a conversa. Atualize para retomar o histórico.');}
    finally{if(alive.current&&!signal.aborted)setLoading(false);}
  },[apply]);
  const loadPanels=useCallback(async()=>{
    const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)return;
    const results=await Promise.allSettled([port.funding(signal),port.automation(signal),port.reports(signal)]);
    if(!alive.current||signal.aborted)return;
    const [f,p,r]=results;
    if(f.status==='fulfilled'){setFunding(f.value);setFundingError('');}else setFundingError('Não foi possível consultar os pagamentos. Nenhum saldo foi presumido.');
    if(p.status==='fulfilled'){setAutomation(p.value);setPolicyError('');}else setPolicyError('Não foi possível confirmar a política atual. Novas autorizações precisam ser verificadas.');
    if(r.status==='fulfilled'){setReports(r.value.reports);setReportId(current=>r.value.reports.some(report=>report.id===current)?current:r.value.reports[0]?.id??'');setReportError('');}else setReportError('Não foi possível carregar os relatórios diários.');
  },[]);
  useEffect(()=>{
    const port=supplied??merchantAssistantEndpoints(apiBaseUrl),controller=new AbortController();client.current=port;lifetime.current=controller;alive.current=true;
    void loadChat();void loadPanels();
    return()=>{alive.current=false;controller.abort();port.dispose();client.current=null;lifetime.current=null;};
  },[apiBaseUrl,supplied,loadChat,loadPanels]);
  useEffect(()=>{onModeChanged?.(policyError||!automation?'unknown':automation.mode);},[automation?.mode,policyError,onModeChanged]);
  useEffect(()=>{if(source){if(compact())setExpanded(false);sourceHeading.current?.focus();}},[source]);
  const processing=!!thread?.turns.some(turn=>!terminal(turn));
  useEffect(()=>{if(!processing)return;let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{await loadChat();if(!cancelled)timer=setTimeout(poll,pollMs);};timer=setTimeout(poll,pollMs);return()=>{cancelled=true;clearTimeout(timer);};
  },[processing,pollMs,loadChat]);
  useEffect(()=>{const timer=setInterval(()=>{const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)return;void port.reports(signal).then(value=>{if(alive.current&&!signal.aborted){setReports(value.reports);setReportId(current=>current||value.reports[0]?.id||'');}}).catch(()=>{/* Existing report retains its timestamp. */});},60000);return()=>clearInterval(timer);},[]);
  async function admit(input:AssistantTurnInput){
    if(sendLock.current||!client.current||!lifetime.current||!threadRef.current)throw new Error('assistant_not_ready');
    sendLock.current=true;setSubmitting(true);const port=client.current,signal=lifetime.current.signal;
    try{const result=await port.submit('meta-ads',threadRef.current.id,input,signal);if(!alive.current||signal.aborted)throw new DOMException('Contexto encerrado','AbortError');
      apply({...threadRef.current,revision:result.revision,turns:[result.turn]});pending.current=null;setChatError('');
      void Promise.resolve(updated.current()).catch(()=>{});
    }catch(error){if(alive.current&&!signal.aborted){let conflict=false;
      if(error instanceof DashboardHttpError&&error.status===409){try{conflict=['assistant_revision_conflict','assistant_turn_pending'].includes(JSON.parse(error.responseBody).code);}catch{/* Public fallback below. */}}
      if(conflict){pending.current=null;await loadChat();if(alive.current&&!signal.aborted)setChatError('A conversa mudou em outra sessão. O histórico foi atualizado; revise sua mensagem antes de enviar novamente.');}
      else setChatError('Não foi possível confirmar o envio. Retome a mesma mensagem para consultar ou concluir o turno sem duplicá-lo.');
    }throw error;}
    finally{sendLock.current=false;if(alive.current&&!signal.aborted)setSubmitting(false);}
  }
  async function send(message:string){
    if(processing)throw new Error('assistant_turn_in_progress');
    if(pending.current&&pending.current.message!==message)throw new Error('assistant_pending_retry');
    const input=pending.current??{message,idempotencyKey:crypto.randomUUID(),expectedRevision:threadRef.current?.revision??0};pending.current=input;await admit(input);
  }
  async function retry(){if(pending.current)await admit(pending.current);else await loadChat();}
  async function refresh(){await loadChat();await loadPanels();await updated.current();}
  async function openSource(id:string){setSourceError('');const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)return;try{const value=await port.source('meta-ads',id,signal);if(alive.current&&!signal.aborted)setSource(value);}catch{if(alive.current&&!signal.aborted)setSourceError('Esta fonte não está disponível na versão atual. A referência histórica permanece identificada.');}}
  async function accept(review:MetaAdsAutomationReview){const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)throw new Error('context_ended');const value=await port.acceptAutomation({scope:review.scope,limits:review.limits,version:review.version,digest:review.digest,idempotencyKey:identity(`accept:${review.digest}`)},signal);if(alive.current&&!signal.aborted){setAutomation({...value,version:review.version});setPolicyError('');}}
  async function manual(){const port=client.current,signal=lifetime.current?.signal,policy=automation?.policy;if(!port||!signal||!policy)throw new Error('policy_unavailable');const value=await port.manual({policyId:policy.id,version:policy.version,idempotencyKey:identity(`revoke:${policy.id}:${policy.version}`)},signal);if(alive.current&&!signal.aborted){setAutomation({...value,version:(automation?.version??policy.version)+1});setPolicyError('');}}
  const account=overview.connection.account;
  const latestReview=thread?.turns.flatMap(turn=>turn.artifacts).filter((artifact):artifact is Extract<AssistantArtifact,{type:'automation_review'}>=>artifact.type==='automation_review').at(-1)?.review;
  const review=latestReview&&latestReview.accountId===account?.id&&latestReview.digest!==automation?.policy?.digest?latestReview:null;
  const campaignNames=Object.fromEntries(overview.campaigns.map(c=>[c.id,c.draft.name])),productNames=Object.fromEntries(overview.campaigns.flatMap(c=>c.products).map(p=>[p.variantId,p.name]));
  const chosenReport=reports.find(report=>report.id===reportId);
  const policyProps={accountId:account?.id??null,state:automation,review,productNames,campaignNames,disabled:!overview.entitled||loading||submitting||!!policyError,error:policyError,onChooseAutomatic:()=>send('Quero configurar o modo automático. Pergunte os produtos, as campanhas, as ações e os limites financeiros antes de apresentar uma política para meu aceite.'),onAccept:accept,onManual:manual};
  function navigateOutside(target:HTMLElement|null){if(compact())setExpanded(false);setTimeout(()=>target?.focus(),0);}
  function reviewProposal(id:string){setFocusedProposal(id);if(compact())setExpanded(false);setTimeout(()=>proposalHeading.current?.focus(),0);}
  function artifact(value:AssistantArtifact,index:number):ReactNode {
    switch(value.type){
      case 'campaign':{const current=overview.campaigns.find(c=>c.id===value.campaign.id);return <CampaignChatArtifact key={`campaign-${value.campaign.id}`} campaign={current??{...value.campaign,managed:false}} overview={overview} api={api} busy={processing||submitting} onUpdated={refresh} onRequest={send}/>;}
      case 'campaign_progress':return <p key={index}>Planejamento preservado. Próximos dados: {value.progress.awaitingFields.map(field=>fields[field]??field).join(', ')||'pronto para revisão'}.</p>;
      case 'generation':{const current=overview.generations.find(g=>g.id===value.generation.id)??value.generation;return <p key={index}>Geração: {current.status==='unknown'?'resultado desconhecido, sem repetição automática':current.status==='succeeded'?'concluída':current.status==='reserved'?'na fila':current.status==='running'?'em andamento':current.status==='partial'?'parcial':'falha confirmada'} · {current.mediaIds.length}/{current.requestedImages} imagens.</p>;}
      case 'proposal':{const current=overview.proposals.find(p=>p.id===value.proposal.id);return <ProposalReview key={value.proposal.id} proposal={current??value.proposal} execution={overview.executions.find(e=>e.proposalId===value.proposal.id)??value.execution??undefined} entitled={overview.entitled&&!!current} connectionEpoch={overview.connection.epoch} api={api} onUpdated={refresh}/>;}
      case 'funding':return <div key={index}><p>Consulta registrada nesta resposta: {value.diagnosis.message}</p>{value.diagnosis.snapshot&&<small>Conta {value.diagnosis.snapshot.accountId} · <time dateTime={value.diagnosis.snapshot.checkedAt}>{new Date(value.diagnosis.snapshot.checkedAt).toLocaleString('pt-BR',{timeZoneName:'short'})}</time> · Fonte: {value.diagnosis.snapshot.source}</small>}<button type="button" className="mga-secondary" onClick={()=>navigateOutside(fundingHeading.current)}>Ver pagamentos atuais</button></div>;
      case 'automation_review':return <p key={index}>Política preparada para revisão. <button type="button" className="mga-secondary" onClick={()=>navigateOutside(policyHeading.current)}>Revisar política</button></p>;
      case 'automation':return <p key={index}>Consulte o modo efetivo e a política atual em Autonomia da IA.</p>;
      case 'daily_report':return <DailyReportArtifact key={value.report.id} report={reports.find(r=>r.id===value.report.id)??value.report} campaignNames={campaignNames} onReview={reviewProposal}/>;
      case 'campaign_status':return <p key={index}>Conta {value.snapshot.accountId} · Estado configurado: {value.snapshot.configuredStatus} · Estado efetivo: {value.snapshot.effectiveStatus} · Consulta em <time dateTime={value.snapshot.checkedAt}>{new Date(value.snapshot.checkedAt).toLocaleString('pt-BR',{timeZoneName:'short'})}</time>. A configuração não confirma veiculação nem vendas.</p>;
    }
  }
  function details(turn:AssistantTurn){return <>{turn.artifacts.map(artifact)}{!!turn.references.length&&<div className="mga-chat-references"><strong>Fontes consultadas</strong><ul>{turn.references.map(reference=><li key={`${reference.id}:${reference.version}`}><button type="button" className="mga-secondary" onClick={()=>void openSource(reference.id)}>Ver fonte: {reference.title}</button><small>Revisada em {reference.reviewedAt.split('-').reverse().join('/')} · Versão {reference.version}</small><p>{reference.excerpt}</p></li>)}</ul></div>}</>;}
  const proposal=overview.proposals.find(p=>p.id===focusedProposal);
  return <div className="mga-agentic-shell"><div className="mga-agentic-content">
    <div ref={fundingHeading} tabIndex={-1}><FundingPanel account={account} diagnosis={funding} error={fundingError} onRefresh={async()=>{const port=client.current,signal=lifetime.current?.signal;if(!port||!signal)return;const value=await port.refreshFunding(signal);if(alive.current&&!signal.aborted){setFunding(value);setFundingError('');}}}/></div>
    <div ref={policyHeading} tabIndex={-1}><AutomationPolicyPanel {...policyProps}/></div>
    <details className="mga-setup"><summary>Relatórios diários</summary>{reportError&&<p role="alert">{reportError}</p>}{reports.length?<><label>Dia do relatório<select aria-label="Dia do relatório" value={reportId} onChange={e=>setReportId(e.target.value)}>{reports.map(report=><option key={report.id} value={report.id}>{report.localDay.split('-').reverse().join('/')} · {report.timezone}</option>)}</select></label>{chosenReport&&<DailyReportArtifact report={chosenReport} campaignNames={campaignNames} onReview={reviewProposal}/>}</>:<p>O relatório será disponibilizado após o fechamento do dia no fuso da conta. Ausência de relatório não confirma gasto zero.</p>}</details>
    {proposal&&<section className="mga-panel"><h2 ref={proposalHeading} tabIndex={-1}>Proposta do relatório</h2><ProposalReview proposal={proposal} execution={overview.executions.find(e=>e.proposalId===proposal.id)} entitled={overview.entitled} connectionEpoch={overview.connection.epoch} api={api} onUpdated={refresh}/></section>}
    {sourceError&&<p role="alert">{sourceError}</p>}{source&&<section className="mga-panel" aria-label="Fonte da resposta"><h2 ref={sourceHeading} tabIndex={-1}>{source.title}</h2><small>Versão atual {source.version} · Revisada em {source.reviewedAt.split('-').reverse().join('/')}</small>{source.sections.map(section=><p key={section.id}>{section.content}</p>)}{source.externalSources.map(origin=>{const url=https(origin.url);return url?<p key={url}><a href={url} target="_blank" rel="noopener noreferrer">{origin.title}</a></p>:null;})}<button type="button" className="mga-secondary" onClick={()=>setSource(null)}>Fechar fonte</button></section>}
    {children}
  </div><ChatDock expanded={expanded} onExpandedChange={setExpanded} context={thread?.context??{id:'meta-ads',label:'Anúncios com IA',capabilities:[]}} turns={thread?.turns??[]} loading={loading} busy={processing||submitting||!overview.entitled} error={chatError} onSend={send} onRetry={retry} renderTurnDetails={details}
    headerExtra={<div className="mga-chat-context"><button type="button" className="mga-secondary" disabled={submitting} onClick={()=>void refresh()}>Atualizar conversa</button>{thread?.campaign&&<p>Planejamento: {thread.campaign.draft.name??'Campanha da loja'} · {thread.campaign.awaitingFields.map(field=>fields[field]??field).join(', ')||'pronto para revisão'}</p>}{!overview.entitled&&<p>Histórico disponível. Novas mensagens exigem o adicional ativo.</p>}</div>}
    empty={<><p>Vamos montar sua campanha juntos. Qual resultado você quer buscar e quais produtos deseja anunciar?</p><p>Também posso explicar pagamentos, criativos e resultados.</p></>}
    older={thread?.nextCursor&&<button type="button" className="mga-secondary" onClick={()=>{const port=client.current,signal=lifetime.current?.signal;if(!port||!signal||!thread.nextCursor)return;void port.page('meta-ads',thread.id,thread.nextCursor,signal).then(value=>{if(alive.current&&!signal.aborted)apply(value);}).catch(()=>{if(alive.current&&!signal.aborted)setChatError('Não foi possível carregar as mensagens anteriores.');});}}>Carregar mensagens anteriores</button>}/>
  </div>;
}
