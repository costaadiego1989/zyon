// @vitest-environment jsdom
import {afterEach,expect,test} from 'vitest';
import {CampaignListMetrics} from './CampaignListMetrics.js';
import {ui} from './test-helpers.js';
import type {MetaAdsMetrics} from '@zyon/shared-types';
let screen:ReturnType<typeof ui>;afterEach(async()=>screen?.close());
export const listMetrics:MetaAdsMetrics={campaignId:'campaign1',since:'2026-11-17',until:'2026-11-17',updatedAt:'2026-11-18T03:00:00Z',timezone:'America/Sao_Paulo',currency:'BRL',source:'meta_reported+zyon_reconciled',attributionWindow:'7d_click+1d_view',spendCents:10000,attributedPurchases:4,paidOrders:1,conversations:5,attributedRevenueCents:40000,confirmedRevenueCents:9900,costPerPurchaseCents:10000,roas:4,contributionCents:null,costCoverage:'unavailable',stale:false,notes:[],impressions:1200,reach:900,linkClicks:40};
test('AGW-07 campaign row shows actual Meta results and period with plain labels',async()=>{
 screen=ui();await screen.render(<CampaignListMetrics destination="store" metrics={listMetrics}/>);
 const value=(label:string)=>Array.from(screen.container.querySelectorAll('dl > div')).find(row=>row.querySelector('dt')?.textContent===label)?.querySelector('dd')?.textContent?.replace(/\u00a0/g,' ');
 expect(value('Valor gasto')).toBe('R$ 100,00');expect(value('Compras (Meta)')).toBe('4');expect(value('Custo por compra')).toBe('R$ 25,00');
 expect(value('Vendas (Meta)')).toBe('R$ 400,00');expect(value('Retorno em vendas')).toContain('R$ 4,00');expect(value('Contas alcançadas')).toBe('900');expect(value('Exibições')).toBe('1.200');expect(value('Cliques no link')).toBe('40');
 expect(screen.container.textContent).toContain('17/11/2026');expect(screen.container.textContent).toContain('Coleta');expect(screen.container.textContent).not.toContain('ROAS');
});
test('AGW-07 WhatsApp cost uses conversations and absent data never becomes zero',async()=>{
 screen=ui();await screen.render(<CampaignListMetrics destination="whatsapp" metrics={{...listMetrics,conversations:0,impressions:null,reach:0,stale:true}}/>);
 const value=(label:string)=>Array.from(screen.container.querySelectorAll('dl > div')).find(row=>row.querySelector('dt')?.textContent===label)?.querySelector('dd')?.textContent;
 expect(value('Conversas iniciadas')).toBe('0');expect(value('Custo por conversa')).toBe('—');expect(value('Exibições')).toBe('—');expect(value('Contas alcançadas')).toBe('0');expect(screen.container.textContent).toContain('Dados desatualizados');
 await screen.render(<CampaignListMetrics destination="store"/>);expect(screen.container.querySelectorAll('dd')).toHaveLength(8);expect(Array.from(screen.container.querySelectorAll('dd')).every(el=>el.textContent==='—')).toBe(true);
});
