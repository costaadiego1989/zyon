// @vitest-environment jsdom
import {act} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import type {MetaAdsDailyReport,MetaAdsMetrics} from '@zyon/shared-types';
import {MetricsDashboard} from './MetricsDashboard.js';
import {ui} from './test-helpers.js';
import {ToastContainer} from '../../components/Toast.js';
vi.mock('../overview/components/ChartWrapper.js',()=>({ChartWrapper:({data}:{data:unknown})=><div className="actual-chart-input" data-points={JSON.stringify(data)}/>}));
let screen:ReturnType<typeof ui>;afterEach(async()=>screen?.close());
const metric=(id:string,spend:number,revenue:number,orders:number):MetaAdsMetrics=>({campaignId:id,since:'2026-11-16',until:'2026-11-16',updatedAt:'2026-11-17T03:01:00Z',timezone:'America/Sao_Paulo',currency:'BRL',attributionWindow:'7d_click,1d_view',source:'meta_reported+zyon_reconciled',spendCents:spend,attributedRevenueCents:revenue,confirmedRevenueCents:orders*2000,paidOrders:orders,conversations:orders+1,costPerPurchaseCents:orders?spend/orders:null,roas:spend?revenue/spend:null,contributionCents:500,costCoverage:'complete',stale:false,notes:[]});
const report=(patch:Partial<MetaAdsDailyReport>={}):MetaAdsDailyReport=>({id:'r',accountId:'100',localDay:'2026-11-16',since:'2026-11-16',until:'2026-11-16',updatedAt:'2026-11-17T03:01:00Z',collectedAt:'2026-11-17T03:01:00Z',timezone:'America/Sao_Paulo',status:'completed',analysisStatus:'completed',campaigns:[metric('c1',2000,8000,2),metric('c2',1000,5000,1)].map(m=>({campaignId:m.campaignId,metrics:m,status:'available',missing:[],recommendations:[],actions:[]})),notes:[],...patch});
const props=()=>({reports:[report()],accountId:'100',campaignNames:{c1:'Camisas',c2:'Bolsas'},active:true,onRefresh:vi.fn(),onSettings:vi.fn()});
test('AF-05 explicit metric refresh has success/error toasts without inventing a new collection',async()=>{screen=ui();const p=props();await screen.render(<><ToastContainer/><MetricsDashboard {...p}/></>);expect(screen.container.querySelector('.ui-toast')).toBeNull();await screen.click('Atualizar métricas');expect(screen.container.querySelector('.ui-toast--success')?.textContent).toContain('Confira a data da coleta');p.onRefresh.mockRejectedValue(new Error('network'));await screen.click('Atualizar métricas');expect(screen.container.querySelector('.ui-toast--error')).not.toBeNull();expect(screen.container.querySelector('time[datetime="2026-11-17T03:01:00Z"]')).not.toBeNull();});
test('AF-03 collection note belongs to expanded chart data instead of an isolated subtitle',async()=>{screen=ui();await screen.render(<MetricsDashboard {...props()}/>);const note=screen.container.querySelector('.mga-metrics-footnote')!;expect(note.closest('details')?.querySelector('summary')?.textContent).toBe('Ver dados dos gráficos');expect((note.closest('details') as HTMLDetailsElement).open).toBe(false);});
function card(label:string){return Array.from(screen.container.querySelectorAll('article.stat-card')).find(el=>el.textContent?.includes(label))!;}
const value=(label:string)=>card(label).querySelector('.stat-card__value')!.textContent;
async function renderDashboard(p:Parameters<typeof MetricsDashboard>[0]){await screen.render(<MetricsDashboard {...p}/>);await act(async()=>{await vi.dynamicImportSettled();});}

test('ADAS-68 period gesture shows real KPIs and sends matching monetary/count series to charts',async()=>{
  screen=ui();await renderDashboard(props());await screen.change('Período das métricas','1');
  expect(value('Investimento nos anúncios')).toMatch(/30,00/);expect(value('Vendas informadas pela Meta')).toMatch(/130,00/);expect(value('Retorno dos anúncios')).toContain('4,33');expect(value('Vendas confirmadas')).toMatch(/60,00/);expect(value('Pedidos pagos')).toBe('3');expect(value('Conversas')).toBe('5');
  const inputs=Array.from(screen.container.querySelectorAll('.actual-chart-input')).map(el=>JSON.parse(el.getAttribute('data-points')!));expect(inputs).toHaveLength(2);expect(inputs[0].slice(1)).toEqual([[30],[130]]);expect(inputs[1].slice(1)).toEqual([[3],[5]]);expect(screen.container.textContent).toContain('America/Sao_Paulo');expect(screen.container.textContent).toContain('16/11/2026');
});
test('ADAS-68 campaign filter updates cards series and comparison using its canonical observation',async()=>{
  screen=ui();await renderDashboard(props());await screen.change('Período das métricas','1');await screen.change('Campanha das métricas','c2');
  expect(value('Investimento nos anúncios')).toMatch(/10,00/);expect(value('Vendas informadas pela Meta')).toMatch(/50,00/);expect(value('Pedidos pagos')).toBe('1');expect(value('Retorno dos anúncios')).toContain('5');const series=JSON.parse(screen.container.querySelector('.actual-chart-input')!.getAttribute('data-points')!);expect(series.slice(1)).toEqual([[10],[50]]);
});
test('ADAS-68 empty state has numeric slots and actionable controls without fabricated zero curves',async()=>{
  screen=ui();const p=props();p.reports=[];await renderDashboard({...p,accountId:null});
  expect(screen.container.querySelectorAll('article.stat-card')).toHaveLength(6);for(const el of Array.from(screen.container.querySelectorAll('.stat-card__value')))expect(el.textContent).toBe('—');expect(screen.container.querySelector('.actual-chart-input')).toBeNull();expect(screen.container.textContent).not.toMatch(/R\$\s*0,00/);await screen.click('Conectar Meta');expect(p.onSettings).toHaveBeenCalledTimes(1);await screen.click('Atualizar métricas');expect(p.onRefresh).toHaveBeenCalledTimes(1);
});
test('ADAS-68 gaps are retained in actual chart data and partial totals are identified',async()=>{
  screen=ui();await renderDashboard(props());expect(card('Investimento nos anúncios').textContent).toContain('Parcial');expect(screen.container.textContent).toContain('1 de 7 dias');expect(value('Retorno dos anúncios')).toBe('—');const series=JSON.parse(screen.container.querySelector('.actual-chart-input')!.getAttribute('data-points')!);expect(series[1]).toEqual([null,null,null,null,null,null,30]);
});
test('ADAS-68 foreign account readings cannot appear in KPI cards chart inputs or campaign choices',async()=>{
  screen=ui();const p=props();p.reports=[report({accountId:'200'})];await renderDashboard(p);expect(value('Investimento nos anúncios')).toBe('—');expect(screen.container.querySelector('.actual-chart-input')).toBeNull();expect(screen.container.querySelector('[aria-label="Campanha das métricas"]')?.textContent).not.toContain('foreign');
});
test('ADAS-68 exact plot values are accessible by disclosure and refresh errors retain their collection time',async()=>{
  screen=ui();await renderDashboard({...props(),error:"Falha na atualização"});await screen.change('Período das métricas','1');const details=screen.container.querySelector<HTMLDetailsElement>('.mga-metrics-data')!;expect(details.open).toBe(false);await act(async()=>details.querySelector('summary')!.click());expect(details.open).toBe(true);expect(details.textContent).toContain('16/11/2026');expect(details.textContent).toMatch(/30,00/);expect(details.textContent).toMatch(/130,00/);expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain('Falha na atualização');expect(screen.container.querySelector('time[datetime="2026-11-17T03:01:00Z"]')).not.toBeNull();
});
