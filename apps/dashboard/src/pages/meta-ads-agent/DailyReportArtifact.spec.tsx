// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import {act} from 'react';
import type { MetaAdsDailyReport, MetaAdsMetrics } from '@zyon/shared-types';
import { ui } from './test-helpers.js';
import { DailyReportArtifact } from './DailyReportArtifact.js';
let screen:ReturnType<typeof ui>;afterEach(async()=>screen?.close());
const metrics:MetaAdsMetrics={campaignId:'c',since:'2026-11-15',until:'2026-11-15',updatedAt:'2026-11-16T03:01:00Z',timezone:'America/Sao_Paulo',currency:'BRL',attributionWindow:'7d_click+1d_view',source:'meta_reported+zyon_reconciled',spendCents:1000,attributedRevenueCents:30000,confirmedRevenueCents:9900,paidOrders:1,conversations:2,costPerPurchaseCents:1000,roas:30,contributionCents:null,costCoverage:'unavailable',stale:false,notes:[]};
const report=():MetaAdsDailyReport=>({id:'r',accountId:'100',localDay:'2026-11-15',timezone:'America/Sao_Paulo',since:'2026-11-15T03:00:00Z',until:'2026-11-16T03:00:00Z',status:'completed',analysisStatus:'completed',collectedAt:'2026-11-16T03:01:00Z',updatedAt:'2026-11-16T03:02:00Z',campaigns:[{campaignId:'c',metrics,status:'available',missing:[],recommendations:[],actions:[]}],notes:['Janela de avaliação: 14 dias.']});
test('ADAS-44 daily report identifies closed day timezone exact collection and separate attributed sales conversations',async()=>{
  screen=ui();await screen.render(<DailyReportArtifact report={report()} campaignNames={{c:'Aurora'}}/>);
  for(const text of ['15/11/2026','America/Sao_Paulo','Conta 100','Aurora','10,00','Receita atribuída pela Meta','300,00','Vendas confirmadas na Zyon','99,00','Conversas','2','meta_reported+zyon_reconciled','7d_click+1d_view','14 dias'])expect(screen.container.textContent).toContain(text);
  expect(Array.from(screen.container.querySelectorAll('time')).map(t=>t.dateTime)).toContain('2026-11-16T03:01:00Z');
});

test('ADAS-63 daily decisions use merchant language and keep secondary evidence behind its actual opening gesture',async()=>{
  screen=ui();const r=report();r.notes=['observed_attribution_not_causal_uplift'];r.campaigns[0].missing=['confirmed_purchases'];r.campaigns[0].metrics={...metrics,notes:['historical_costs_incomplete','confirmed_orders_require_verified_origin']};r.campaigns[0].recommendations=[{id:'rec',campaignId:'c',priority:'paid_sales',hypothesis:'Aguardando dados: confirmed_purchases',evidence:{since:'2026-11-03',until:'2026-11-15',costCoverage:'unavailable',attributedRevenueCents:30000},proposedAction:null,proposedFields:{},status:'awaiting_data',createdAt:r.updatedAt}];
  await screen.render(<DailyReportArtifact report={r}/>);const text=screen.container.textContent!;
  for(const code of ['confirmed_purchases','historical_costs_incomplete','confirmed_orders_require_verified_origin','costCoverage','attributedRevenueCents'])expect(text).not.toContain(code);
  expect(text).toContain('vendas confirmadas');expect(text).toContain('Custos históricos incompletos');
  const primary=screen.container.querySelector('.mga-report-metrics')!;expect(primary.textContent).toContain('Gasto de mídia');expect(primary.textContent).toContain('10,00');expect(primary.textContent).toContain('Receita atribuída pela Meta');expect(primary.closest('details')).toBeNull();
  const evidence=screen.container.querySelector<HTMLDetailsElement>('.mga-recommendation-evidence')!;expect(evidence.open).toBe(false);await act(async()=>evidence.querySelector('summary')!.click());expect(evidence.open).toBe(true);expect(evidence.textContent).toContain('Início da análise');expect(evidence.textContent).toContain('03/11/2026');expect(evidence.textContent).toContain('Cobertura de custos');expect(evidence.textContent).toContain('indisponível');expect(evidence.textContent).toContain('300,00');
});

test('ADAS-44 civil report dates remain in the account day rather than shifting to the prior UTC date',async()=>{
  screen=ui();const r=report();r.since=r.until='2026-11-15';await screen.render(<DailyReportArtifact report={r}/>);
  const times=Array.from(screen.container.querySelectorAll('time'));expect(times[0].dateTime).toBe('2026-11-15');expect(times[0].textContent).toBe('15/11/2026');expect(screen.container.textContent).not.toContain('14/11/2026');expect(screen.container.textContent).toContain('America/Sao_Paulo');
});
test('ADAS-43 null fields are unavailable while a measured zero stays zero',async()=>{
  screen=ui();const r=report();r.campaigns[0].metrics={...metrics,spendCents:0,attributedRevenueCents:null,confirmedRevenueCents:null,conversations:null};await screen.render(<DailyReportArtifact report={r}/>);
  const row=(label:string)=>Array.from(screen.container.querySelectorAll('dl > div')).find(e=>e.querySelector('dt')?.textContent===label)!.querySelector('dd')!.textContent;
  expect(row('Gasto de mídia')).toMatch(/0,00/);for(const label of ['Receita atribuída pela Meta','Vendas confirmadas na Zyon','Conversas'])expect(row(label)).toBe('Indisponível');
});
test('ADAS-45 partial collection and insufficient sample cannot imply a winning ad or automatic optimization',async()=>{
  screen=ui();const r=report();r.status='partial';r.analysisStatus='awaiting_data';r.campaigns[0]={...r.campaigns[0],metrics:null,status:'awaiting_data',missing:['Métricas indisponíveis']};await screen.render(<DailyReportArtifact report={r}/>);
  expect(screen.container.textContent).toContain('Coleta parcial');expect(screen.container.textContent).toContain('Dados insuficientes');expect(screen.container.textContent).toContain('Métricas indisponíveis');expect(screen.container.textContent).not.toContain('vencedor');expect(screen.container.querySelector('button')).toBeNull();
});
test('ADAS-47 recommendation evidence and durable action outcome remain separate and review requires a gesture',async()=>{
  screen=ui();const r=report();r.campaigns[0].recommendations=[{id:'rec',campaignId:'c',priority:'roas',hypothesis:'Avaliar pausa pelo retorno observado',evidence:{spendCents:1000,roas:0.5},proposedAction:'pause',proposedFields:{},status:'pending_review',createdAt:r.updatedAt}];r.campaigns[0].actions=[{proposalId:'p',executionId:null,status:'pending_review',reason:'Aprovação individual necessária',error:null}];const review=vi.fn();await screen.render(<DailyReportArtifact report={r} onReview={review}/>);
  expect(screen.container.textContent).toContain('ROAS');expect(screen.container.textContent).toContain('Avaliar pausa pelo retorno observado');expect(screen.container.textContent).toContain('Aprovação individual necessária');expect(screen.container.textContent).toContain('Aguardando aprovação');expect(review).not.toHaveBeenCalled();await screen.click('Revisar proposta');expect(review).toHaveBeenCalledWith('p');expect(screen.container.textContent).not.toContain('Pausada na Meta');
});
test('ADAS-50 unknown analysis and sent operation remain visible without offering blind replay',async()=>{
  screen=ui();const r=report();r.analysisStatus='unknown';r.campaigns[0].actions=[{proposalId:'p',executionId:'e',status:'execution_unknown',reason:'Resposta remota não confirmada',error:'meta_execution_unknown'}];await screen.render(<DailyReportArtifact report={r}/>);
  expect(screen.container.textContent).toContain('Análise com resultado desconhecido');expect(screen.container.textContent).toContain('Resultado desconhecido');expect(screen.container.textContent).toContain('Resposta remota não confirmada');expect(screen.container.querySelector('button')).toBeNull();expect(screen.container.textContent).not.toContain('Veiculação confirmada');
});
