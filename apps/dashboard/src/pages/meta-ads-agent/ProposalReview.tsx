import { useEffect, useState } from "react";
import type { MetaAdsExecution, MetaAdsProposal } from "@zyon/shared-types";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import { DashboardHttpError } from "../../api/http/error.js";
import { actions, date, executionFeedback, executionStates, money, priorities, useAction } from "./presentation.js";
import './proposal-review.css';
type JsonObject = Record<string, unknown>;
const object = (v: unknown): JsonObject => v && typeof v === "object" && !Array.isArray(v) ? v as JsonObject : {};
const states:Record<string,string>={ACTIVE:'Ativo',PAUSED:'Pausado',ARCHIVED:'Arquivado',DELETED:'Excluído',not_created:'Ainda não criada',UNKNOWN:'Não confirmado',IN_PROCESS:'Em processamento',PENDING_REVIEW:'Em análise',CAMPAIGN_PAUSED:'Campanha pausada',ADSET_PAUSED:'Conjunto pausado'};
const platforms:Record<string,string>={facebook:'Facebook',instagram:'Instagram',whatsapp:'WhatsApp',threads:'Threads',messenger:'Messenger',audience_network:'Aplicativos parceiros'};
const types:Record<string,[string,string]>={campaign:['Campanha','campanhas'],ad_set:['Conjunto de anúncios','conjuntos de anúncios'],creative:['Material do anúncio','materiais do anúncio'],ad:['Anúncio','anúncios']};
function references(...values:unknown[]):Array<{type:string;id:string|null}>{
 const result=new Map<string,{type:string;id:string|null}>();
 for(const value of values)for(const entry of Array.isArray(value)?value:[]){const ref=object(entry),type=typeof entry==='string'?entry:String(ref.type??'');if(!Object.hasOwn(types,type))continue;const id=typeof ref.id==='string'?ref.id:null;result.set(`${type}:${id??''}`,{type,id});}
 return [...result.values()];
}
function MetaReferences({items}:{items:ReturnType<typeof references>}){
 const identified=items.filter(item=>item.id);
 if(!identified.length)return null;
 return <details className="mga-meta-references" data-meta-references><summary>Referências na Meta</summary><dl>{identified.map(item=><div key={`${item.type}:${item.id}`}><dt>{types[item.type][0]}</dt><dd>{item.id}</dd></div>)}</dl></details>;
}
function countryName(value:unknown):string|null{if(typeof value!=='string'||!/^[A-Z]{2}$/.test(value))return null;try{return new Intl.DisplayNames(['pt-BR'],{type:'region'}).of(value)??null;}catch{return null;}}
function Audience({value,country}:{value:unknown;country:unknown}){
 const targeting=object(value),geo=object(targeting.geo_locations),range=Array.isArray(targeting.age_range)?targeting.age_range:[];
 const countries=(Array.isArray(geo.countries)?geo.countries:[country]).map(countryName).filter((name):name is string=>!!name);
 const minimum=targeting.age_min??range[0],maximum=targeting.age_max??range[1];
 const age=typeof minimum==='number'?typeof maximum==='number'&&maximum<65?`De ${minimum} a ${maximum} anos`:`A partir de ${minimum} anos`:null;
 const genders=Array.isArray(targeting.genders)?targeting.genders:[],gender=genders.length===1&&genders[0]===1?'Homens':genders.length===1&&genders[0]===2?'Mulheres':genders.length===2&&genders.includes(1)&&genders.includes(2)?'Homens e mulheres':genders.length?'Seleção de gênero definida na Meta':null;
 const locations=[['regions','região selecionada','regiões selecionadas'],['cities','cidade selecionada','cidades selecionadas'],['zips','CEP selecionado','CEPs selecionados'],['custom_locations','área selecionada','áreas selecionadas']].flatMap(([key,singular,plural])=>{
  const selected=Array.isArray(geo[key])?geo[key] as unknown[]:[];if(!selected.length)return[];
  const named=selected.map(item=>object(item).name).filter((name):name is string=>typeof name==='string'&&!!name.trim());
  return[named.length===selected.length&&named.length<=3?new Intl.ListFormat('pt-BR',{type:'conjunction'}).format(named):`${selected.length} ${selected.length===1?singular:plural} na Meta`];
 });
 const extra=['flexible_spec','interests','behaviors','custom_audiences','excluded_custom_audiences','excluded_geo_locations'].some(key=>Array.isArray(targeting[key])?(targeting[key] as unknown[]).length>0:Object.keys(object(targeting[key])).length>0);
 const names=(Array.isArray(targeting.effective_publisher_platforms)?targeting.effective_publisher_platforms:[]).flatMap(key=>typeof key==='string'&&Object.hasOwn(platforms,key)?[platforms[key]]:[]);
 return <>{[...countries,...locations,age,gender].filter(Boolean).join(' · ')||'Público não informado'}{extra&&<small>Outros filtros de público configurados na Meta.</small>}{!!names.length&&<small>{new Intl.ListFormat('pt-BR',{style:'long',type:'conjunction'}).format([...new Set(names)])}</small>}</>;
}
function Snapshot({value}: {value: JsonObject}) {
  const draft=object(value.draft);value={...draft,...value};
  const budget = object(value.budget); const lifetime=budget.cadence==='lifetime'||budget.amountCents==null&&budget.lifetime_budget!=null&&(budget.daily_budget==null||Number(budget.daily_budget)===0);
  const amount = budget.amountCents ?? (lifetime?budget.lifetime_budget:budget.daily_budget);
  const currency = typeof budget.currency === "string" ? budget.currency : "BRL";
  return <div className="mga-snapshot">
    <dl className="mga-change-facts">
      {Object.hasOwn(value,'status')&&<div><dt>Situação</dt><dd>{typeof value.status==='string'&&Object.hasOwn(states,value.status)?states[value.status]:'Não informado'}</dd></div>}
      {Object.hasOwn(value,'budget')&&<div><dt>Investimento</dt><dd>{amount!=null?money(Number(amount),currency):'Não informado'}{amount!=null&&<small>{lifetime?'No total do período':'por dia'}</small>}</dd></div>}
      {(value.targeting!==undefined||value.country!==undefined)&&<div><dt>Público</dt><dd><Audience value={value.targeting} country={value.country}/></dd></div>}
      {typeof budget.startsAt==='string'&&<div><dt>Início</dt><dd>{date(budget.startsAt)}</dd></div>}
      {typeof budget.endsAt==='string'&&<div><dt>Término</dt><dd>{date(budget.endsAt)}</dd></div>}
      {typeof value.destination==='string'&&<div><dt>Destino</dt><dd>{value.destination==='store'?'Loja online':'WhatsApp'}</dd></div>}
      {typeof value.priority==='string'&&<div><dt>Objetivo</dt><dd>{Object.hasOwn(priorities,value.priority)?priorities[value.priority as keyof typeof priorities]:'Não informado'}</dd></div>}
      {typeof value.headline==='string'&&<div><dt>Título do anúncio</dt><dd>{value.headline}</dd></div>}
      {typeof value.primaryText==='string'&&<div><dt>Texto do anúncio</dt><dd>{value.primaryText}</dd></div>}
    </dl>
    {Array.isArray(value.media) && <div className="mga-media-list">{value.media.map((v, i) => {const m = object(v); return typeof m.url === "string" ? <figure key={i}><img src={m.url} alt={`Criativo revisado ${i + 1}`}/><figcaption>Imagem {i + 1}</figcaption></figure> : null;})}</div>}
    {Array.isArray(value.products)&&<ul className="mga-change-products">{value.products.map((v,i)=>{const p=object(v);return <li key={i}>{String(p.name)} · {money(Number(p.priceCents),String(p.currency??'BRL'))}</li>;})}</ul>}
  </div>;
}
export function ProposalReview({proposal, execution, entitled, connectionEpoch, api, onUpdated}: {proposal: MetaAdsProposal; execution?: MetaAdsExecution; entitled: boolean; connectionEpoch: number; api: MetaAdsAgentApi; onUpdated: () => void | Promise<void>}) {
  const [view, setView] = useState(proposal); const [result, setResult] = useState(execution); const [uncertain, setUncertain] = useState(false); const [acknowledged, setAcknowledged] = useState(false); const action = useAction();
  const reviewVersion = JSON.stringify([proposal.id, proposal.digest, proposal.campaignId, proposal.kind, proposal.connectionEpoch, proposal.before, proposal.after, proposal.reasoning],
    (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  useEffect(() => {setView(proposal);}, [proposal]);
  useEffect(() => {setAcknowledged(false);}, [reviewVersion, connectionEpoch]);
  useEffect(() => {setResult(execution);}, [execution]);
  const stale = view.status === "stale" || view.connectionEpoch !== connectionEpoch;
  const disabled = !entitled || action.busy || stale;
  const reviewed = acknowledged && !disabled;
  const affected=references(view.before.objects,view.after.objects);
  const scope=Object.keys(types).filter(type=>type!=='creative').flatMap(type=>{const count=affected.filter(item=>item.type===type).length;return count?[`${count} ${count===1?types[type][0].toLocaleLowerCase('pt-BR'):types[type][1]}`]:[];}).join(' · ');
  const proposed=view.kind==='publish'&&view.after.targeting===undefined&&view.after.country===undefined?{...view.after,targeting:view.before.targeting}:view.after;
  return <article className="mga-proposal" aria-labelledby={`proposal-${view.id}`}><header><div><h3 id={`proposal-${view.id}`}>{actions[view.kind]}</h3><p>{view.reasoning}</p></div><small>Criada em {date(view.createdAt)}</small></header>
    {!!scope&&<p className="mga-proposal-scope" data-proposal-scope>{scope}</p>}
    <div className="mga-comparison"><section><h4>Antes</h4><Snapshot value={view.before}/></section><section><h4>Proposto</h4><Snapshot value={proposed}/></section></div>
    <MetaReferences items={references(view.before.objects,view.after.objects,result?.objects)}/>
    {view.kind === "prepare" && <p>A preparação cria objetos em rascunho ou pausados. A publicação terá sua própria aprovação.</p>}
    {view.kind === "publish" && <p>Publicar pode iniciar os gastos acima, pagos diretamente à Meta. A publicação não garante exibição nem vendas.</p>}
    {stale && <p role="status">Proposta desatualizada. Solicite uma nova proposta e revise novamente.</p>}
    {view.status === "pending_review" && !stale && <><label className="mga-ack"><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={e => setAcknowledged(e.target.checked)}/>Conferi o anúncio, o público e o investimento desta alteração.</label><div className="mga-actions"><button type="button" data-action="approve" disabled={!reviewed} onClick={() => void action.run(async () => {setView(await api.approve(view.id, view.digest)); await onUpdated();},"Aprovação registrada.")}>{view.kind === "publish" ? "Aprovar publicação" : "Aprovar alteração"}</button><button type="button" className="mga-secondary" disabled={disabled} onClick={() => void action.run(async () => {setView(await api.reject(view.id)); await onUpdated();},"Proposta rejeitada. Nenhuma alteração executada.")}>Rejeitar proposta</button></div></>}
    {view.status === "approved" && !result && !view.executionId && !uncertain && <><p>Aprovação registrada em {date(view.approvedAt)}.</p><button type="button" disabled={disabled} onClick={() => void action.run(async () => {let result;try {result=await api.execute(view.id);setResult(result);} catch (e) {if (e instanceof DashboardHttpError && e.status >= 400 && e.status < 500) {setView(v => ({...v,status:"stale"})); await onUpdated();} else setUncertain(true); throw e;} await onUpdated();return result;},executionFeedback)}>Executar alteração aprovada</button></>}
    {uncertain && !result && <div className="mga-notice"><p role="status">Resultado desconhecido. Atualize o histórico para conferir o envio antes de tentar novamente.</p><button type="button" className="mga-secondary" disabled={action.busy} onClick={() => void action.run(async () => {await onUpdated();},"Histórico atualizado.")}>Atualizar histórico</button></div>}
    {view.status === "rejected" && <p role="status">Proposta rejeitada. Nenhuma alteração executada.</p>}
    {result && <div className="mga-notice"><p role="status">{view.kind === "prepare" && result.status === "remote_paused" ? "Preparada, sem veiculação" : executionStates[result.status]}</p>{result.error && <p>A operação requer revisão do resultado antes de uma nova proposta.</p>}
      {["sending", "execution_unknown", "publishing", "active_unconfirmed", "remote_draft"].includes(result.status) && <button type="button" className="mga-secondary" disabled={action.busy} onClick={() => void action.run(async () => {const next=await api.reconcile(result.id);setResult(next);await onUpdated();return next;},executionFeedback)}>Consultar estado na Meta</button>}
    </div>}
    {action.busy && <p role="status">Confirmando operação…</p>}{action.error && <p role="alert">{action.error}</p>}
  </article>;
}
