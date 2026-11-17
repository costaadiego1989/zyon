import {lazy,Suspense,useId,useMemo,useState} from 'react';
import type uPlot from 'uplot';
import type {MetaAdsDailyReport} from '@zyon/shared-types';
import {BarChart3,RefreshCw} from 'lucide-react';
import {StatCard,StatCardGroup} from '../overview/components/StatCard.js';
import {buildAdsDashboard,type AdsPoint,type AdsTotals} from './metrics-dashboard.js';
import {money} from './presentation.js';
import './metrics-dashboard.css';

interface Props {
  reports:MetaAdsDailyReport[];accountId:string|null;campaignNames:Record<string,string>;
  active?:boolean;error?:string;loading?:boolean;
  onRefresh:()=>void|Promise<void>;onSettings:()=>void;
}
const day=(value:string)=>value.split('-').reverse().join('/');
const number=(value:number|null)=>value===null?'—':value.toLocaleString('pt-BR',{maximumFractionDigits:2});
const amount=(value:number|null,currency:string|null)=>value===null||!currency?'—':money(value,currency);
const ratio=(value:number|null)=>value===null?'—':number(value)+'×';
const token=(name:string)=>typeof document==='undefined'?'':getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const Chart=lazy(()=>import('../overview/components/ChartWrapper.js').then(module=>({default:module.ChartWrapper})));

function MetricChart({points,currency,kind,active}:{points:AdsPoint[];currency:string|null;kind:'money'|'count';active:boolean}) {
  const title=kind==='money'?'Verba e receita Meta':'Pedidos e conversas';
  const series=kind==='money'?['Gasto de mídia','Receita atribuída pela Meta']:['Pedidos Zyon','Conversas Meta'];
  const data=useMemo<uPlot.AlignedData>(()=>[
    points.map(point=>Date.parse(point.day+'T12:00:00Z')/1000),
    points.map(point=>kind==='money'?(point.spendCents===null?null:point.spendCents/100):point.paidOrders),
    points.map(point=>kind==='money'?(point.attributedRevenueCents===null?null:point.attributedRevenueCents/100):point.conversations),
  ],[points,kind]);
  const options=useMemo<uPlot.Options>(()=>({width:400,height:210,
    series:[{},...series.map((label,index)=>({label,stroke:token(index?'--color-brand':'--color-text-muted'),width:2,spanGaps:false,points:{show:points.length===1,size:6}}))],
    scales:{x:{time:true,...(points.length===1?{range:[data[0][0]-43200,data[0][0]+43200] as [number,number]}:{})},y:{range:(_plot,_min,max)=>[0,Math.max(1,max*1.12)]}},
    axes:[{stroke:token('--color-text-muted'),grid:{show:false},ticks:{show:false},values:(_plot,ticks)=>ticks.map(value=>new Date(value*1000).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit'}))},
      {size:58,stroke:token('--color-text-muted'),grid:{stroke:token('--color-border'),width:1},ticks:{show:false},values:(_plot,ticks)=>ticks.map(value=>kind==='money'&&currency?new Intl.NumberFormat('pt-BR',{style:'currency',currency,maximumFractionDigits:0}).format(value):number(value))}],
    cursor:{drag:{setScale:false}},legend:{show:false},
  }),[kind,currency,points]);
  const hasData=data.slice(1).some(values=>Array.from(values).some(value=>value!==null));
  return <figure className="mga-metric-chart" aria-label={title}>
    <figcaption><h3>{title}</h3><ul className="mga-chart-legend">{series.map((label,index)=><li key={label}><span className={index?'mga-chart-brand':'mga-chart-neutral'}/>{label}</li>)}</ul></figcaption>
    {hasData&&active?<div data-metric-chart={kind}><Suspense fallback={<div className="mga-chart-empty" role="status">Carregando gráfico…</div>}><Chart options={options} data={data} style={{height:210}}/></Suspense></div>:<div className="mga-chart-empty"><BarChart3 size={28} strokeWidth={1.4} aria-hidden="true"/><span>{hasData?'Abra Métricas para ver o gráfico':'Sem dados coletados'}</span></div>}
  </figure>;
}

export function MetricsDashboard({reports,accountId,campaignNames,active=true,error,loading,onRefresh,onSettings}:Props) {
  const [days,setDays]=useState<1|7|30>(7),[campaignId,setCampaignId]=useState(''),[refreshing,setRefreshing]=useState(false),[refreshError,setRefreshError]=useState('');
  const id=useId();
  const data=useMemo(()=>buildAdsDashboard(reports,{accountId,days,campaignId}),[reports,accountId,days,campaignId]);
  const campaigns=useMemo(()=>[...new Set([...Object.keys(campaignNames),...reports.filter(report=>report.accountId===accountId).flatMap(report=>report.campaigns.map(row=>row.campaignId))])].map((value,index)=>({id:value,name:campaignNames[value]??`Campanha ${index+1}`})),[reports,accountId,campaignNames]);
  const name=(value:string)=>campaigns.find(c=>c.id===value)?.name??'Campanha';
  const note=(key:keyof AdsTotals)=>data.totals[key]!==null&&data.partialMetrics.includes(key)?'Parcial':undefined;
  async function refresh(){if(refreshing)return;setRefreshing(true);setRefreshError('');try{await onRefresh();}catch{setRefreshError('Não foi possível atualizar as métricas.');}finally{setRefreshing(false);}}
  return <section className="mga-metrics" aria-labelledby={`${id}-title`}>
    <div className="mga-metrics-heading"><div><h2 id={`${id}-title`}>Desempenho dos anúncios</h2><p>{data.since&&data.until?`${day(data.since)} a ${day(data.until)}`:'Aguardando a primeira coleta'}{data.timezone&&<> · {data.timezone}</>}</p></div>
      <button type="button" className="mga-secondary mga-metrics-refresh" aria-label="Atualizar métricas" disabled={loading||refreshing} onClick={()=>void refresh()}><RefreshCw size={15} aria-hidden="true"/>{refreshing?'Atualizando…':'Atualizar'}</button></div>
    <div className="mga-metrics-filters"><label>Período<select aria-label="Período das métricas" value={days} onChange={event=>setDays(Number(event.target.value) as 1|7|30)}><option value="1">Último dia coletado</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select></label>
      <label>Campanha<select aria-label="Campanha das métricas" value={campaignId} onChange={event=>setCampaignId(event.target.value)}><option value="">Todas as campanhas</option>{campaigns.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label></div>
    {(error||refreshError)&&<p className="mga-notice" role="alert">{error||refreshError}</p>}
    <div className="mga-metrics-status"><span>{data.hasData?(data.partial?`${data.daysWithData} de ${data.totalDays} dias com dados · coleta parcial`:'Coleta disponível'):'Sem métricas coletadas'}</span>{data.updatedAt&&<time dateTime={data.updatedAt}>Atualizado em {new Date(data.updatedAt).toLocaleString('pt-BR',{timeZone:data.timezone??'UTC'})}</time>}</div>
    {!accountId&&<button type="button" className="mga-secondary" onClick={onSettings}>Conectar Meta</button>}
    <div className="mga-metric-kpis"><StatCardGroup columns={3}>
      <StatCard label="Gasto de mídia" value={amount(data.totals.spendCents,data.currency)} note={note('spendCents')}/>
      <StatCard label="Receita Meta" value={amount(data.totals.attributedRevenueCents,data.currency)} note={note('attributedRevenueCents')??'Receita atribuída'}/>
      <StatCard label="ROAS atribuído" value={ratio(data.totals.roas)}/>
      <StatCard label="Vendas confirmadas" value={amount(data.totals.confirmedRevenueCents,data.currency)} note={note('confirmedRevenueCents')??'Receita na Zyon'}/>
      <StatCard label="Pedidos pagos" value={number(data.totals.paidOrders)} note={note('paidOrders')}/>
      <StatCard label="Conversas" value={number(data.totals.conversations)} note={note('conversations')}/>
    </StatCardGroup></div>
    <dl className="mga-metric-secondary"><div><dt>Custo por compra confirmada</dt><dd>{amount(data.totals.costPerPurchaseCents,data.currency)}</dd></div><div><dt>Contribuição após mídia</dt><dd>{amount(data.totals.contributionCents,data.currency)}{note('contributionCents')&&<small> · Parcial</small>}</dd></div></dl>
    <MetricChart points={data.points} currency={data.currency} kind="money" active={active}/>
    <MetricChart points={data.points} currency={data.currency} kind="count" active={active}/>
    {!!data.campaigns.length&&<section className="mga-metrics-campaigns" aria-label="Comparação de campanhas"><h3>Por campanha</h3><div className="mga-metrics-table"><table><thead><tr><th scope="col">Campanha</th><th scope="col">Gasto</th><th scope="col">Pedidos</th><th scope="col">ROAS</th></tr></thead><tbody>{data.campaigns.map(c=><tr key={c.id}><th scope="row"><button type="button" className="mga-secondary" onClick={()=>setCampaignId(c.id)}>{name(c.id)}</button></th><td>{amount(c.totals.spendCents,data.currency)}</td><td>{number(c.totals.paidOrders)}</td><td>{ratio(c.totals.roas)}</td></tr>)}</tbody></table></div></section>}
    <details className="mga-metrics-data"><summary>Ver dados dos gráficos</summary><div className="mga-metrics-table"><table><thead><tr><th scope="col">Dia</th><th scope="col">Gasto</th><th scope="col">Receita Meta</th><th scope="col">Pedidos</th><th scope="col">Conversas</th></tr></thead><tbody>{data.points.map(point=><tr key={point.day}><th scope="row">{day(point.day)}</th><td>{amount(point.spendCents,data.currency)}</td><td>{amount(point.attributedRevenueCents,data.currency)}</td><td>{number(point.paidOrders)}</td><td>{number(point.conversations)}</td></tr>)}</tbody></table></div></details>
    <small className="mga-metrics-footnote">Dias encerrados · — sem leitura disponível · receita atribuída não comprova incremento de vendas.</small>
  </section>;
}
