import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {AssistantReference,AssistantTurn,CashbackAssistantReport,CashbackConfigurationChecklistItem,CashbackProgramView} from '@zyon/shared-types';
import {CheckCircle2,Circle,ClipboardList,FileChartColumn,FileText} from 'lucide-react';
import {ChatDock} from '../../components/merchant-assistant/ChatDock.js';
import {Button} from '../../components/Button.js';
import {cashbackDate,cashbackMoney} from './cashback-form.js';
import {useCashbackAssistant,type CashbackAssistantClient} from './useCashbackAssistant.js';
import './cashback-assistant.css';

interface Props {
 apiBaseUrl:string;merchantId:string;scopeKey:string;program:CashbackProgramView|null;client?:CashbackAssistantClient;
 onDraftUpdated:()=>void|Promise<unknown>;onReview:()=>Promise<CashbackProgramView|null>;onManual:()=>void;
 expanded?:boolean;onExpandedChange?:(expanded:boolean,reason?:'toggle'|'navigation')=>void;
}
const context={id:'cashback',label:'Cashback',capabilities:['help','draft','reports']};
const groups={earn:'Como ganhar',release:'Liberação e validade',redeem:'Como usar',combination:'Combinação e tetos',terms:'Regulamento'};
const dateOnly=(value:string)=>new Date(value).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
function checklistValue(item:CashbackConfigurationChecklistItem):string {
 if(!item.completed)return 'Pendente';
 if(item.value===null)return item.field==='expiryDays'?'Sem vencimento':'Sem limite';
 if(typeof item.value==='boolean')return item.value?'Permitido':'Não permitido';
 if(typeof item.value==='number')return item.kind==='money'?cashbackMoney(item.value):item.kind==='percent'?`${(item.value/100).toLocaleString('pt-BR',{maximumFractionDigits:2})}%`:item.kind==='days'?`${item.value} ${item.value===1?'dia':'dias'}`:String(item.value);
 return ({payment_confirmed:'Pagamento confirmado',order_fulfilled:'Pedido concluído',respect_general:'Respeitar também o teto geral',cashback_specific:'Teto específico de cashback'} as Record<string,string>)[item.value || ''] || item.value || 'Preenchido';
}
function Report({report}:{report:CashbackAssistantReport}){
 const m=report.metrics;
 const movements=[['Crédito gerado',m.grantedCents],['Crédito liberado',m.releasedCents],['Cashback utilizado',m.redeemedCents],['Crédito restituído',m.restoredCents],['Crédito expirado',m.expiredCents],['Crédito estornado',m.reversedCents],['Perda promocional',m.lossCents]] as const;
 return <details className="cashback-chat-report"><summary><FileChartColumn size={16} aria-hidden="true"/>Relatório de cashback · {dateOnly(m.from)} a {dateOnly(m.to)}</summary><p>Movimentações no período · Datas e horários de Brasília · Valores em reais (R$)</p><dl>{movements.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{cashbackMoney(value)}</dd></div>)}<div><dt>Clientes que ganharam</dt><dd>{m.buyersGranted}</dd></div><div><dt>Clientes que utilizaram</dt><dd>{m.buyersRedeemed}</dd></div><div><dt>Pedidos com cashback</dt><dd>{m.ordersWithCashback}</dd></div><div><dt>Receita associada</dt><dd>{cashbackMoney(m.associatedRevenueCents)}</dd></div></dl><p>Não representa aumento de receita causado pelo programa.</p><section aria-label="Saldos atuais do relatório"><h4>Saldos atuais</h4><p>Posição em {cashbackDate(m.asOf)} · Brasília. Inclui créditos anteriores ao período.</p><dl><div><dt>Disponível</dt><dd>{cashbackMoney(m.availableCents)}</dd></div><div><dt>Pendente</dt><dd>{cashbackMoney(m.pendingCents)}</dd></div><div><dt>Reservado</dt><dd>{cashbackMoney(m.reservedCents)}</dd></div></dl></section><section aria-label="Orçamento atual do relatório"><h4>Orçamento atual · {report.budgetMonth.split('-').reverse().join('/')}</h4><p>Mês de Brasília no instante da consulta, independente do período do relatório.</p><dl><div><dt>Concedido no mês</dt><dd>{cashbackMoney(m.budgetIssuedCents)}</dd></div><div><dt>Comprometido em compras</dt><dd>{cashbackMoney(m.budgetCommittedCents)}</dd></div><div><dt>Limite mensal</dt><dd>{m.budgetLimitCents===null?'Sem limite':cashbackMoney(m.budgetLimitCents)}</dd></div></dl></section></details>;
}
function externalUrl(value:string){try{const url=new URL(value);return url.protocol==='https:'?url.href:null;}catch{return null;}}
export function CashbackAssistant({apiBaseUrl,merchantId,scopeKey,program,client,onDraftUpdated,onReview,onManual,expanded,onExpandedChange}:Props){
 const s=useCashbackAssistant({apiBaseUrl,merchantId,scopeKey,client,onDraftUpdated});
 const [localOpen,setLocalOpen]=useState(false),[showChecklist,setShowChecklist]=useState(false);
 const [sourceReference,setSourceReference]=useState<AssistantReference|null>(null),[reviewError,setReviewError]=useState<string|null>(null);
 const sourceHeading=useRef<HTMLHeadingElement>(null),sourceTrigger=useRef<HTMLButtonElement|null>(null),checklistHeading=useRef<HTMLHeadingElement>(null);
 const open=expanded??localOpen;
 function changeOpen(value:boolean,reason:'toggle'|'navigation'='navigation'){setLocalOpen(value);onExpandedChange?.(value,reason);}
 const artifacts=s.turns.filter(t=>t.status==='completed').flatMap(t=>t.artifacts);
 const current=artifacts.filter(a=>a.type==='cashback_draft'&&a.program.merchantId===merchantId&&!!program?.configurationRevision&&a.program.configurationRevision===program.configurationRevision&&!!a.checklist).at(-1);
 const checklist=current?.type==='cashback_draft'?current.checklist:undefined;
 const next=checklist?.items.find(item=>item.field===checklist.nextField);
 useLayoutEffect(()=>{if(!s.source)return;changeOpen(false);sourceHeading.current?.focus();sourceHeading.current?.scrollIntoView({block:'start'});},[s.source]);
 useEffect(()=>{setShowChecklist(false);setSourceReference(null);setReviewError(null);},[scopeKey]);
 async function ask(message:string){if(!s.canSend)return;await s.send(message);}
 async function review(){setReviewError(null);try{if(!await onReview())setReviewError('Não foi possível abrir o rascunho atual. Use a configuração manual para tentar novamente.');else changeOpen(false);}catch{setReviewError('Não foi possível abrir o rascunho atual. Use a configuração manual para tentar novamente.');}}
 function toggleChecklist(){setShowChecklist(value=>!value);if(!showChecklist)requestAnimationFrame(()=>{checklistHeading.current?.focus();checklistHeading.current?.scrollIntoView({block:'nearest'});});}
 async function source(reference:AssistantReference,trigger:HTMLButtonElement){sourceTrigger.current=trigger;setSourceReference(reference);await s.openSource(reference.id);}
 function closeSource(){s.closeSource();changeOpen(true);requestAnimationFrame(()=>sourceTrigger.current?.focus());}
 function details(turn:AssistantTurn){return <>
  {turn.status==='completed'&&turn.artifacts.map((artifact,index)=>artifact.type==='cashback_report'?<Report key={index} report={artifact.report}/>:artifact.type==='cashback_draft'?<div key={index} className="cashback-chat-draft"><p>Regras consultadas nesta resposta. Para ativar, revise o rascunho salvo atual.</p><button type="button" onClick={()=>void review()}>Revisar rascunho</button></div>:null)}
  {!!turn.references.length&&<details className="cashback-chat-references"><summary>Fontes consultadas · {turn.references.length}</summary><ul>{turn.references.map(reference=><li key={`${reference.id}:${reference.version}`}><button type="button" onClick={event=>void source(reference,event.currentTarget)}>Ver fonte: {reference.title}</button><small>Revisada em {reference.reviewedAt.slice(0,10).split('-').reverse().join('/')} · Versão {reference.version}</small></li>)}</ul></details>}
 </>;}
 return <div className="cashback-assistant">
  <ChatDock context={context} turns={s.turns} loading={s.loading} busy={s.busy} error={s.error||undefined} presentation="floating" pageKey={`cashback:${scopeKey}`} expanded={open} onExpandedChange={value=>changeOpen(value,'toggle')} onSend={s.send} onRetry={async()=>{if(!await s.retry())throw new Error('Resultado ainda não confirmado');}}
   headerExtra={<div className="cashback-chat-tools"><button type="button" aria-label="Ver checklist completo" aria-expanded={showChecklist} onClick={toggleChecklist}><ClipboardList size={15} aria-hidden="true"/>Checklist{checklist?` · ${checklist.completed}/${checklist.total}`:''}</button><button type="button" disabled={!s.canSend} onClick={()=>void ask('Quero um relatório do cashback deste mês.').catch(()=>{})}><FileChartColumn size={15} aria-hidden="true"/>Relatório do mês</button></div>}
   empty={<div className="cashback-chat-empty"><p>Posso explicar as regras, montar seu rascunho passo a passo e consultar relatórios.</p><button type="button" disabled={!s.canSend} onClick={()=>void ask('Quero configurar cashback passo a passo.').catch(()=>{})}>Configurar passo a passo</button><p>Você revisa as regras salvas antes de ativar.</p></div>}
   older={<>{showChecklist&&<section className="cashback-checklist" aria-label="Checklist do rascunho salvo"><h3 ref={checklistHeading} tabIndex={-1}>Checklist do rascunho salvo</h3>{checklist?<><p>{checklist.completed} de {checklist.total} decisões preenchidas</p><progress aria-label="Progresso da configuração" value={checklist.completed} max={checklist.total}/>{Object.entries(groups).map(([group,label])=><section className="cashback-checklist-group" key={group}><h4>{label}</h4><dl>{checklist.items.filter(item=>item.group===group).map(item=><div key={item.field} data-checklist-field={item.field} data-completed={item.completed}>{item.completed?<CheckCircle2 size={15} aria-label="Preenchido"/>:<Circle size={15} aria-label="Pendente"/>}<div><dt>{item.label}</dt><dd>{item.kind==='text'&&item.completed?<details><summary>Ver regulamento salvo</summary><p className="cashback-terms">{checklistValue(item)}</p></details>:checklistValue(item)}</dd></div></div>)}</dl></section>)}<p className="cashback-checklist-next">{next?`Próxima decisão: ${next.label}.`:'Todas as decisões estão preenchidas. Revise o rascunho antes de ativar.'}</p>{next?<button type="button" disabled={!s.canSend} onClick={()=>void ask('Quero continuar a configuração do cashback a partir da próxima decisão pendente.').catch(()=>{})}>Continuar configuração</button>:<button type="button" onClick={()=>void review()}>Revisar rascunho</button>}</>:<><p>Consulte o rascunho atual para conferir todas as decisões salvas. Respostas anteriores podem conter versões antigas.</p><button type="button" disabled={!s.canSend} onClick={()=>void ask('Quero consultar meu checklist de cashback.').catch(()=>{})}>Consultar checklist atual</button></>}</section>}{s.thread?.nextCursor&&<button type="button" disabled={s.olderLoading} onClick={()=>void s.loadOlder()}>Carregar mensagens anteriores</button>}</>}
   renderTurnDetails={details}/>
  {(s.error||reviewError||s.sourceError)&&<div className="cashback-assistant-manual"><Button variant="ghost" size="sm" onClick={()=>{changeOpen(false);onManual();}}>Configurar manualmente</Button>{reviewError&&<p role="alert">{reviewError}</p>}{s.sourceError&&<p role="alert">{s.sourceError}</p>}</div>}
  {s.source&&<section className="panel cashback-source" aria-label="Fonte da resposta"><h2 ref={sourceHeading} tabIndex={-1}>{s.source.title}</h2>{sourceReference&&sourceReference.version!==s.source.version&&<p role="status">Esta fonte foi atualizada desde a resposta. Abaixo está a versão revisada atual; a referência original era {sourceReference.version}.</p>}<p className="cashback-help">Versão {s.source.version} · Revisada em {s.source.reviewedAt.slice(0,10).split('-').reverse().join('/')}</p>{s.source.sections.map(section=><p key={section.id}>{section.content}</p>)}{s.source.externalSources.map(origin=>{const url=externalUrl(origin.url);return url?<p key={url}><a href={url} target="_blank" rel="noopener noreferrer">{origin.title}</a></p>:null;})}<Button variant="outline" onClick={closeSource}><FileText size={15} aria-hidden="true"/>Fechar fonte</Button></section>}
 </div>;
}
