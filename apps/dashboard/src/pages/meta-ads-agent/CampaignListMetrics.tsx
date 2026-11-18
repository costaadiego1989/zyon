import type {MetaAdsMetrics} from '@zyon/shared-types';
import {money} from './presentation.js';

const count=(value:number|null|undefined)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const number=(value:number|null|undefined)=>count(value)?.toLocaleString('pt-BR')??'—';
const day=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value.split('-').reverse().join('/'):'não informado';
export function CampaignListMetrics({destination,metrics,loading=false,error,onRetry}:{destination:'store'|'whatsapp'|'unknown';metrics?:MetaAdsMetrics;loading?:boolean;error?:string;onRetry?:()=>void}) {
 const m=metrics,currency=m?.currency,validCurrency=!!currency&&/^[A-Z]{3}$/.test(currency);
 const amount=(value:number|null|undefined)=>validCurrency&&typeof value==='number'&&Number.isFinite(value)&&value>=0?money(value,currency):'—';
 const result=count(destination==='whatsapp'?m?.conversations:m?.attributedPurchases);
 const cost=result!==null&&result>0&&m?.spendCents!==null&&m?.spendCents!==undefined?Math.round(m.spendCents/result):null;
 const returnValue=m?.roas!==null&&m?.roas!==undefined&&Number.isFinite(m.roas)&&m.roas>=0&&m.spendCents!==null&&m.spendCents>0?amount(Math.round(m.roas*100)):'—';
 const values=[['Valor gasto',amount(m?.spendCents)],[destination==='whatsapp'?'Conversas iniciadas':'Compras (Meta)',number(result)],[destination==='whatsapp'?'Custo por conversa':'Custo por compra',amount(cost)],['Vendas (Meta)',amount(m?.attributedRevenueCents)],['Retorno em vendas',returnValue],['Contas alcançadas',number(m?.reach)],['Exibições',number(m?.impressions)],['Cliques no link',number(m?.linkClicks)]];
 const conversationCount=count(m?.conversations);
 if(destination==='unknown')values.push(['Conversas iniciadas',number(conversationCount)],['Custo por conversa',amount(conversationCount!==null&&conversationCount>0&&m?.spendCents!==null&&m?.spendCents!==undefined?Math.round(m.spendCents/conversationCount):null)]);
 return <section className="mga-list-metrics" aria-label="Resultados da campanha"><dl>{values.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd>{label==='Retorno em vendas'&&value!=='—'&&<small>por {money(100,currency)} investido</small>}</div>)}</dl>
 <div className="mga-list-metrics-note">{loading?<span role="status">Buscando resultados…</span>:error?<span role="alert">{error}</span>:m?<><span>{day(m.since)}{m.until!==m.since&&<> a {day(m.until)}</>}</span><span>{m.stale?'Dados desatualizados · ':''}Coleta: {Number.isFinite(Date.parse(m.updatedAt))?new Date(m.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'não informada'} · horário de Brasília</span></>:<span>Aguardando a primeira coleta.</span>}{error&&onRetry&&<button type="button" className="mga-secondary" onClick={onRetry}>Tentar consultar resultados</button>}</div>
 </section>;
}
