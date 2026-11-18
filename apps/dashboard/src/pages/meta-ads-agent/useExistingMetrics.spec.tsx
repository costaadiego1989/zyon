// @vitest-environment jsdom
import {act} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {useExistingMetrics} from './useExistingMetrics.js';
import {ui} from './test-helpers.js';
import type {MetaAdsAgentApi} from '../../api/endpoints/meta-ads-agent.js';
import type {MetaAdsMetrics} from '@zyon/shared-types';
let screen:ReturnType<typeof ui>;afterEach(async()=>screen?.close());
const metric=(id:string):MetaAdsMetrics=>({campaignId:`existing-${id}`,since:'2026-11-17',until:'2026-11-18',updatedAt:'2026-11-18T12:00:00Z',timezone:'America/Sao_Paulo',currency:'BRL',source:'meta_reported',attributionWindow:'7d_click',spendCents:1000,attributedRevenueCents:5000,confirmedRevenueCents:null,paidOrders:0,conversations:null,costPerPurchaseCents:null,roas:5,contributionCents:null,costCoverage:'unavailable',stale:false,notes:[]});
function Harness({api,scope='account1',ids=['1','2','3']}:{api:MetaAdsAgentApi;scope?:string;ids?:string[]}){const state=useExistingMetrics(api,ids,scope,'2026-11-17','2026-11-18',true);return <><pre>{JSON.stringify(state.rows)}</pre><button onClick={()=>state.retry('1')}>Repetir 1</button></>;}
test('AGW-08 visible reads stay bounded and late account results never enter the current list',async()=>{
 screen=ui();const resolvers:Record<string,(m:MetaAdsMetrics)=>void>={};const existingMetrics=vi.fn((id:string)=>new Promise<MetaAdsMetrics>(resolve=>{resolvers[id]=resolve;}));const api={existingMetrics} as unknown as MetaAdsAgentApi;
 await screen.render(<Harness api={api}/>);expect(existingMetrics.mock.calls.map(([id])=>id)).toEqual(['1','2']);
 await act(async()=>resolvers['1'](metric('1')));expect(screen.container.textContent).toContain('existing-1');expect(existingMetrics.mock.calls.map(([id])=>id)).toEqual(['1','2','3']);
 await screen.render(<Harness api={api} scope="account2" ids={[]}/>);await act(async()=>{resolvers['2'](metric('2'));resolvers['3'](metric('3'));});expect(screen.container.querySelector('pre')!.textContent).toBe('{}');
});
test('AGW-08 failed row retries by gesture and rejects another campaign or period',async()=>{
 screen=ui();const existingMetrics=vi.fn().mockResolvedValueOnce({...metric('1'),until:'2026-11-16'}).mockResolvedValueOnce(metric('1'));const api={existingMetrics} as unknown as MetaAdsAgentApi;
 await screen.render(<Harness api={api} ids={['1']}/>);expect(screen.container.textContent).toContain('Não foi possível consultar');expect(screen.container.textContent).not.toContain('existing-1');
 await screen.click('Repetir 1');expect(screen.container.textContent).toContain('existing-1');expect(existingMetrics).toHaveBeenLastCalledWith('1','2026-11-17','2026-11-18');
});
