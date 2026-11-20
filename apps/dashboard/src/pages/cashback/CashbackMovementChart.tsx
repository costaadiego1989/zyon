import {useMemo} from 'react';
import type uPlot from 'uplot';
import type {CashbackDailyMovement} from '@zyon/shared-types';
import {ChartWrapper} from '../overview/components/ChartWrapper.js';
import {cashbackMoney} from './cashback-form.js';
import './cashback-movement.css';

const empty: CashbackDailyMovement[]=[];
const dateLabel=(date:string)=>date.split('-').reverse().join('/');
function canvasToken(token:string,fallback:string){return typeof document === 'undefined' ? fallback : getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;}
export function CashbackMovementChart({data}:{data:CashbackDailyMovement[] | undefined}) {
 const days=data || empty;
 const aligned=useMemo<uPlot.AlignedData>(()=>[days.map(x=>Date.parse(`${x.date}T12:00:00Z`)/1000),days.map(x=>x.grantedCents/100),days.map(x=>x.redeemedCents/100)],[days]);
 const options=useMemo<uPlot.Options>(()=>{
  const text=canvasToken('--color-text-muted','#9ca3af'),grid=canvasToken('--color-border','#303530'),granted=canvasToken('--color-brand','#51c687'),redeemed=canvasToken('--color-info','#80b5ed');
  return {width:600,height:260,legend:{show:false},series:[{}, {label:'Crédito gerado',stroke:granted,width:2,points:{show:days.length===1,size:7}}, {label:'Cashback utilizado',stroke:redeemed,width:2,dash:[5,3],points:{show:days.length===1,size:7}}],scales:{x:{time:true,...(days.length===1?{range:[aligned[0][0]-43200,aligned[0][0]+43200]}:{})},y:{range:(_u,min,max)=>[Math.min(0,min),max===0?1:max*1.15]}},axes:[{stroke:text,grid:{stroke:grid},ticks:{stroke:grid},values:(_u,ticks)=>ticks.map(t=>new Date(t*1000).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit'})),...(days.length===1?{splits:()=>[aligned[0][0]]}:{})},{stroke:text,grid:{stroke:grid},ticks:{stroke:grid},size:64,values:(_u,ticks)=>ticks.map(n=>`R$ ${n.toLocaleString('pt-BR',{maximumFractionDigits:2})}`)}],cursor:{drag:{setScale:false}}};
 },[days.length,aligned]);
 const hasMovement=days.some(x=>x.grantedCents!==0||x.redeemedCents!==0);
 return <div className="cashback-movement" data-motion="none">
  <div className="cashback-chart-legend"><span><i className="cashback-chart-key cashback-chart-key--granted" aria-hidden="true"/>Crédito gerado</span><span><i className="cashback-chart-key cashback-chart-key--redeemed" aria-hidden="true"/>Cashback utilizado</span><small>Valores em reais (R$)</small></div>
  {data===undefined ? <p className="cashback-chart-empty" role="status">Série diária indisponível. Atualize para consultar as movimentações.</p> : hasMovement ? <div aria-label="Gráfico de movimentações diárias. Dados equivalentes na tabela abaixo."><ChartWrapper options={options} data={aligned} style={{height:260}}/></div> : <p className="cashback-chart-empty" role="status">Nenhuma movimentação no período</p>}
  {data!==undefined&&days.length>0&&<details className="cashback-chart-data"><summary>Ver dados do gráfico</summary><div className="cashback-table-wrap" role="region" aria-label="Dados das movimentações" tabIndex={0}><table className="cashback-table"><caption>Movimentações diárias de cashback</caption><thead><tr><th scope="col">Data · Brasília</th><th scope="col">Crédito gerado</th><th scope="col">Cashback utilizado</th></tr></thead><tbody>{days.map(x=><tr key={x.date}><td><time dateTime={x.date}>{dateLabel(x.date)}</time></td><td>{cashbackMoney(x.grantedCents)}</td><td>{cashbackMoney(x.redeemedCents)}</td></tr>)}</tbody></table></div></details>}
 </div>;
}
