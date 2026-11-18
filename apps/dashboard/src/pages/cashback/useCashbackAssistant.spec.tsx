// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantThread, AssistantTurn } from '@zyon/shared-types';
import { ui } from '../meta-ads-agent/test-helpers.js';
import { useCashbackAssistant, type CashbackAssistantClient } from './useCashbackAssistant.js';

const turn = (id: string, status: AssistantTurn['status'] = 'completed'): AssistantTurn => ({id, threadId:'thread', ordinal:Number(id.replace(/\D/g,'')) || 1, status, message:`pergunta ${id}`, reply:status === 'completed' ? `resposta ${id}` : null, references:[], artifacts:[], error:null, createdAt:'2026-11-18T12:00:00Z', updatedAt:'2026-11-18T12:00:00Z'});
const thread = (turns: AssistantTurn[] = [], nextCursor: string | null = null): AssistantThread => ({id:'thread',context:{id:'cashback',label:'Cashback',capabilities:[]},revision:turns.length,campaign:null,turns,nextCursor,updatedAt:'2026-11-18T12:00:00Z'});
function client(): CashbackAssistantClient { return {thread:vi.fn().mockResolvedValue(thread()),page:vi.fn().mockResolvedValue(thread()),submit:vi.fn().mockResolvedValue({turn:turn('1','queued'),revision:1,replayed:false}),source:vi.fn().mockResolvedValue({id:'guide',version:'1',title:'Regras revisadas',url:'/guide',reviewedAt:'2026-11-18',sections:[{id:'rules',content:'Crédito da mesma loja.'}],externalSources:[]})}; }
function Probe({api,scope='store-a',updated=()=>{}}:{api:CashbackAssistantClient;scope?:string;updated?:()=>void}) {
  const s=useCashbackAssistant({apiBaseUrl:'/api',merchantId:scope,scopeKey:scope,client:api,onDraftUpdated:updated,pollMs:20});
  return <><p>{s.loading?'Carregando':s.busy?'Processando':'Pronto'}</p><p role="alert">{s.error}</p><ol>{s.turns.map(t=><li key={t.id}>{t.reply || t.status}</li>)}</ol><button disabled={!s.canSend} onClick={()=>void s.send('quero configurar').catch(()=>{})}>Enviar</button><button onClick={()=>void s.retry()}>Reconciliar</button><button onClick={()=>void s.loadOlder()}>Anteriores</button><button onClick={()=>void s.openSource('guide')}>Fonte</button><p>{s.source?.title}</p><p>{s.sourceError}</p></>;
}
const mounted:ReturnType<typeof ui>[]=[];
afterEach(async()=>{for(const view of mounted.splice(0))await view.close();vi.useRealTimers();});
async function mount(api:CashbackAssistantClient,scope='store-a',updated?:()=>void){const v=ui();mounted.push(v);await v.render(<Probe api={api} scope={scope} updated={updated}/>);return v;}

describe('cashback conversation lifecycle',()=>{
  it('CBX-17 loads the current history and admits an explicit message once',async()=>{
    const api=client();vi.mocked(api.thread).mockResolvedValue(thread([turn('1')]));const v=await mount(api);
    expect(v.container.textContent).toContain('resposta 1');await v.click('Enviar');
    expect(api.submit).toHaveBeenCalledWith('cashback','thread',expect.objectContaining({message:'quero configurar',expectedRevision:1,idempotencyKey:expect.any(String)}),expect.any(AbortSignal));
    expect(v.container.textContent).toContain('Processando');expect((v.container.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('CBX-17 polls queued work and displays the completed canonical reply',async()=>{
    vi.useFakeTimers();const api=client();vi.mocked(api.thread).mockResolvedValueOnce(thread()).mockResolvedValue(thread([turn('1')]));const v=await mount(api);await v.click('Enviar');
    await act(async()=>{await vi.advanceTimersByTimeAsync(25);});
    expect(v.container.textContent).toContain('resposta 1');expect(v.container.textContent).toContain('Pronto');expect((v.container.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
  });
  it('CBX-17 merges older pages without losing the latest turn or duplicating history',async()=>{
    const api=client();vi.mocked(api.thread).mockResolvedValue(thread([turn('2')],'before-2'));vi.mocked(api.page).mockResolvedValue({...thread([turn('1'),turn('2')]),revision:2});const v=await mount(api);await v.click('Anteriores');
    expect(Array.from(v.container.querySelectorAll('li')).map(x=>x.textContent)).toEqual(['resposta 1','resposta 2']);expect(api.page).toHaveBeenCalledWith('cashback','thread','before-2',expect.any(AbortSignal));
  });
  it('CBX-31 CBX-32 reads back before replaying the same uncertain admission',async()=>{
    const order:string[]=[];const api=client();vi.mocked(api.thread).mockImplementation(async()=>{order.push('read');return thread();});vi.mocked(api.submit).mockImplementationOnce(async()=>{order.push('write');throw new Error('timeout');}).mockImplementationOnce(async()=>{order.push('replay');return {turn:turn('1'),revision:1,replayed:true};});const v=await mount(api);await v.click('Enviar');
    expect(v.container.textContent).toContain('confirmar');expect((v.container.querySelector('button') as HTMLButtonElement).disabled).toBe(true);await v.click('Reconciliar');
    const writes=vi.mocked(api.submit).mock.calls;expect(writes[1][2]).toEqual(writes[0][2]);expect(order).toEqual(['read','write','read','replay']);expect(v.container.textContent).toContain('resposta 1');
  });
  it('CBX-33 cancels and discards old history and source on same-client store change',async()=>{
    let resolveHistory!:(v:AssistantThread)=>void;let resolveSource!:(v:Awaited<ReturnType<CashbackAssistantClient['source']>>)=>void;
    const api=client();vi.mocked(api.thread).mockImplementationOnce(()=>new Promise(r=>{resolveHistory=r;})).mockResolvedValue({...thread([turn('2')]),id:'store-b-thread'});vi.mocked(api.source).mockImplementation(()=>new Promise(r=>{resolveSource=r;}));const v=await mount(api);await v.click('Fonte');
    const signal=vi.mocked(api.thread).mock.calls[0][1]!;await v.render(<Probe api={api} scope="store-b"/>);await act(async()=>{resolveHistory(thread([turn('1')]));resolveSource({id:'guide',version:'1',title:'Fonte antiga',url:'/x',reviewedAt:'now',sections:[],externalSources:[]});});
    expect(signal.aborted).toBe(true);expect(v.container.textContent).toContain('resposta 2');expect(v.container.textContent).not.toContain('resposta 1');expect(v.container.textContent).not.toContain('Fonte antiga');
  });
  it('CBX-33 aborts the mounted session on unmount without disposing a shared client',async()=>{
    const api=client();const dispose=vi.fn();Object.assign(api,{dispose});const v=await mount(api);const signal=vi.mocked(api.thread).mock.calls[0][1]!;await v.close();mounted.splice(mounted.indexOf(v),1);expect(signal.aborted).toBe(true);expect(dispose).not.toHaveBeenCalled();
  });
  it('CBX-17 opens the reviewed source and keeps source failures explicit',async()=>{
    const api=client();const v=await mount(api);await v.click('Fonte');expect(v.container.textContent).toContain('Regras revisadas');vi.mocked(api.source).mockRejectedValueOnce(new Error('offline'));await v.click('Fonte');expect(v.container.textContent).not.toContain('Regras revisadas');expect(v.container.textContent).toContain('Não foi possível carregar a fonte');
  });
  it('CBX-37 exposes unavailable chat and recovers through an explicit retry',async()=>{
    const api=client();vi.mocked(api.thread).mockRejectedValueOnce(new Error('offline'));const v=await mount(api);expect(v.container.textContent).toContain('configuração manual');await v.click('Reconciliar');expect(v.container.textContent).toContain('Pronto');expect((v.container.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
  });
  it('CBX-32 treats persisted draft artifacts as readback signals and suppresses foreign artifacts',async()=>{
    const api=client();const updated=vi.fn();const own=turn('1');own.artifacts=[{type:'cashback_draft',program:{merchantId:'store-a'} as never,missingFields:[]}];const foreign=turn('2');foreign.artifacts=[{type:'cashback_draft',program:{merchantId:'store-b'} as never,missingFields:[]}];vi.mocked(api.thread).mockResolvedValue(thread([own,foreign]));const v=await mount(api,'store-a',updated);expect(updated).toHaveBeenCalledTimes(1);await v.click('Reconciliar');expect(updated).toHaveBeenCalledTimes(1);expect(v.container.textContent).toContain('resposta 1');
  });
  it('CBX-32 keeps an unknown provider result blocked without another admission',async()=>{
    const api=client();vi.mocked(api.thread).mockResolvedValue(thread([turn('1','unknown')]));const v=await mount(api);expect(v.container.textContent).toContain('resultado');expect((v.container.querySelector('button') as HTMLButtonElement).disabled).toBe(true);await v.click('Reconciliar');expect(api.submit).not.toHaveBeenCalled();expect(v.container.textContent).toContain('unknown');
  });
});
