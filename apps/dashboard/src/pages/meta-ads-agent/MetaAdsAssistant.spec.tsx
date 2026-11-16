// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AssistantThread, AssistantTurn, AssistantTurnInput, MetaAdsAutomationReview, MetaAdsDailyReport } from '@zyon/shared-types';
import type { MerchantAssistantApi } from '../../api/endpoints/merchant-assistant.js';
import type { MetaAdsAgentApi } from '../../api/endpoints/meta-ads-agent.js';
import { MetaAdsAssistant } from './MetaAdsAssistant.js';
import { ui } from './test-helpers.js';
import { campaign,overview } from './fixtures.js';
import { DashboardHttpError } from '../../api/http/error.js';
let screen:ReturnType<typeof ui>;afterEach(async()=>screen?.close());
const turn=(patch:Partial<AssistantTurn>={}):AssistantTurn=>({id:'t',threadId:'h',ordinal:1,status:'completed',message:'Ajuda',reply:'Resposta persistida',references:[],artifacts:[],error:null,createdAt:'2026-11-16T12:00:00Z',updatedAt:'2026-11-16T12:00:00Z',...patch});
const thread=(turns:AssistantTurn[]=[]):AssistantThread=>({id:'h',context:{id:'meta-ads',label:'Anúncios com IA',capabilities:[]},revision:turns.length,campaign:null,turns,nextCursor:null,updatedAt:'2026-11-16T12:00:00Z'});
const manual={mode:'manual' as const,policy:null,committedCents:0,availableCents:null,version:0};
const policyReview:MetaAdsAutomationReview={accountId:'123',connectionEpoch:1,version:1,digest:'policy-digest',warnings:[],scope:{variantIds:['variant1'],campaignIds:[],allowNewCampaigns:true,destination:'store',priority:'paid_sales',country:'BR',actions:['pause']},limits:{currency:'BRL',cadence:'lifetime',campaignCeilingCents:10000,storeCeilingCents:20000,startsAt:'2026-11-16T12:00:00Z',endsAt:'2026-11-23T12:00:00Z'}};
const automatic={...manual,mode:'automatic' as const,version:1,availableCents:20000,policy:{...policyReview,id:'p',acceptedBy:'owner',acceptedAt:'2026-11-16T12:00:00Z',revokedAt:null}};
function fixture(history=thread()){
  const client={dispose:vi.fn(),thread:vi.fn().mockResolvedValue(history),page:vi.fn().mockResolvedValue(history),submit:vi.fn(async(_context:string,_id:string,input:AssistantTurnInput)=>({turn:turn({status:'queued',reply:null,message:input.message}),revision:1,replayed:false})),source:vi.fn().mockResolvedValue({id:'funds',version:'1',title:'Como financiar anúncios',url:'/?tab=meta-ads-agent&help=funds',reviewedAt:'2026-11-16',sections:[{id:'one',content:'A verba é paga diretamente à Meta.'}],externalSources:[{title:'Documentação da Meta',url:'https://developers.facebook.com/docs/graph-api/reference/ad-account/'}]}),funding:vi.fn().mockResolvedValue({snapshot:null,status:'unknown',message:'Sem leitura financeira',nextSteps:[],error:null}),refreshFunding:vi.fn().mockResolvedValue({snapshot:null,status:'unknown',message:'Sem leitura financeira',nextSteps:[],error:null}),automation:vi.fn().mockResolvedValue(manual),acceptAutomation:vi.fn().mockResolvedValue(automatic),manual:vi.fn().mockResolvedValue({...manual,version:2}),reports:vi.fn().mockResolvedValue({reports:[]}),report:vi.fn()};
  return {client,props:{merchantId:'a',apiBaseUrl:'https://api.example.test',overview:overview(),api:{} as MetaAdsAgentApi,client:client as unknown as MerchantAssistantApi,onUpdated:vi.fn().mockResolvedValue(undefined),pollMs:60000}};
}
test('ADAS-11 persisted conversation and campaign progress load beside existing page controls',async()=>{
  screen=ui();const h=thread([turn()]);h.campaign={campaignId:null,draft:{name:'Planejamento salvo'},awaitingFields:['budget']};const f=fixture(h);await screen.render(<MetaAdsAssistant {...f.props}><button>Controle existente</button></MetaAdsAssistant>);
  expect(screen.container.textContent).toContain('Resposta persistida');expect(screen.container.textContent).toContain('Planejamento salvo');expect(screen.container.textContent).toContain('Orçamento');expect(screen.container.textContent).toContain('Controle existente');expect(f.client.submit).not.toHaveBeenCalled();
});
test('ADAS-10 send gesture displays admitted processing and confirmed reply from a later read',async()=>{
  screen=ui();const f=fixture();await screen.render(<MetaAdsAssistant {...f.props}/>);await screen.change('Mensagem para a IA','Quero anunciar bolsas');await screen.click('Enviar mensagem');expect(screen.container.textContent).toContain('Processando');expect(f.client.submit.mock.calls[0][2]).toMatchObject({message:'Quero anunciar bolsas',expectedRevision:0});
  f.client.thread.mockResolvedValue(thread([turn({message:'Quero anunciar bolsas',reply:'Qual prioridade você escolhe?'})]));await screen.click('Atualizar conversa');expect(screen.container.textContent).toContain('Qual prioridade você escolhe?');expect(f.client.submit).toHaveBeenCalledTimes(1);
});
test('ADAS-10 polling completes a persisted running turn through reads without another paid submission',async()=>{
  screen=ui();const f=fixture(thread([turn({status:'running',reply:null})]));await screen.render(<MetaAdsAssistant {...f.props} pollMs={10}/>);f.client.thread.mockResolvedValue(thread([turn({reply:'Coleta concluída'})]));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,45));});expect(screen.container.textContent).toContain('Coleta concluída');expect(f.client.submit).not.toHaveBeenCalled();
});

test('ADAS-26 completing a queued campaign turn refreshes canonical overview once without another submission',async()=>{
  screen=ui();const f=fixture(thread([turn({status:'running',reply:null})]));await screen.render(<MetaAdsAssistant {...f.props} pollMs={10}/>);
  f.client.thread.mockResolvedValue(thread([turn({reply:'Rascunho salvo',artifacts:[{type:'campaign',campaign:campaign()}]})]));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,70));});
  expect(screen.container.textContent).toContain('Rascunho salvo');expect(f.props.onUpdated).toHaveBeenCalledTimes(1);expect(f.client.funding).toHaveBeenCalledTimes(2);expect(f.client.submit).not.toHaveBeenCalled();
});

test('ADAS-28 queued generation refreshes canonical results until complete without paying again',async()=>{
  screen=ui();const f=fixture();f.props.overview.generations=[{id:'g',campaignId:'c',status:'reserved'} as never];await screen.render(<MetaAdsAssistant {...f.props} pollMs={10}/>);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,45));});expect(f.props.onUpdated.mock.calls.length).toBeGreaterThan(0);expect(f.client.submit).not.toHaveBeenCalled();
  f.props.overview={...f.props.overview,generations:[]};await screen.render(<MetaAdsAssistant {...f.props} pollMs={10}/>);const count=f.props.onUpdated.mock.calls.length;
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,45));});expect(f.props.onUpdated).toHaveBeenCalledTimes(count);
});
test('ADAS-14 explicit retry keeps the same admitted input identity and clears recovered send error',async()=>{
  screen=ui();const f=fixture();f.client.submit.mockRejectedValueOnce(new Error('lost'));await screen.render(<MetaAdsAssistant {...f.props}/>);await screen.change('Mensagem para a IA','Preserve esta intenção');await screen.click('Enviar mensagem');expect((screen.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Preserve esta intenção');await screen.click('Retomar envio');expect(f.client.submit.mock.calls[0][2]).toEqual(f.client.submit.mock.calls[1][2]);expect(screen.container.textContent).toContain('Processando');expect(screen.container.textContent).not.toContain('Você pode retomar sem perder');
});
test('ADAS-12 switching stores immediately removes private history and ignores the old late response',async()=>{
  screen=ui();const old=fixture();let release!:(h:AssistantThread)=>void;old.client.thread.mockImplementation(()=>new Promise<AssistantThread>(yes=>{release=yes;}));await screen.render(<MetaAdsAssistant {...old.props}/>);const next=fixture(thread([turn({reply:'Nova loja'})]));await screen.render(<MetaAdsAssistant {...next.props} merchantId="b"/>);await act(async()=>release(thread([turn({reply:'SEGREDO DA LOJA ANTIGA'})])));expect(screen.container.textContent).toContain('Nova loja');expect(screen.container.textContent).not.toContain('SEGREDO DA LOJA ANTIGA');expect(old.client.dispose).toHaveBeenCalledTimes(1);
});
test('ADAS-11 reload resumes server history without recreating a campaign or resubmitting a turn',async()=>{
  screen=ui();const first=fixture(thread([turn({status:'running',reply:null})]));await screen.render(<MetaAdsAssistant {...first.props}/>);await screen.close();screen=ui();const next=fixture(thread([turn({reply:'Campanha preservada'})]));await screen.render(<MetaAdsAssistant {...next.props}/>);expect(screen.container.textContent).toContain('Campanha preservada');expect(next.client.submit).not.toHaveBeenCalled();
});
test('ADAS-17 validated reference opens its authorized source reader with origin and review date',async()=>{
  screen=ui();const f=fixture(thread([turn({references:[{id:'funds:one',version:'1',title:'Como financiar anúncios',url:'/?tab=meta-ads-agent&help=funds',reviewedAt:'2026-11-16',excerpt:'A verba pertence à Meta.'}]})]));await screen.render(<MetaAdsAssistant {...f.props}/>);await screen.click('Ver fonte: Como financiar anúncios');expect(f.client.source).toHaveBeenCalledWith('meta-ads','funds:one',expect.any(AbortSignal));expect(screen.container.textContent).toContain('A verba é paga diretamente à Meta.');expect(screen.container.textContent).toContain('16/11/2026');expect(screen.container.querySelector('a[href="https://developers.facebook.com/docs/graph-api/reference/ad-account/"]')).not.toBeNull();
});

test('ADAS-62 source excerpts stay out of the initial conversation and the disclosure opens the complete reviewed source',async()=>{
  screen=ui();const f=fixture(thread([turn({references:[{id:'funds:one',version:'1',title:'Como financiar anúncios',url:'/?tab=meta-ads-agent&help=funds',reviewedAt:'2026-11-16',excerpt:'TRECHO_LONGO_QUE_NAO_DEVE_INUNDAR_A_CONVERSA'}]})]));
  await screen.render(<MetaAdsAssistant {...f.props}/>);const refs=screen.container.querySelector<HTMLDetailsElement>('.mga-chat-references')!;expect(refs.tagName).toBe('DETAILS');expect(refs.open).toBe(false);expect(screen.container.querySelector('.chat-dock-history')?.textContent).not.toContain('TRECHO_LONGO_QUE_NAO_DEVE_INUNDAR_A_CONVERSA');
  await act(async()=>refs.querySelector('summary')!.click());expect(refs.open).toBe(true);expect(refs.textContent).toContain('16/11/2026');expect(refs.textContent).toContain('Versão 1');
  await screen.click('Ver fonte: Como financiar anúncios');expect(f.client.source).toHaveBeenCalledWith('meta-ads','funds:one',expect.any(AbortSignal));expect(screen.container.querySelector('[aria-label="Fonte da resposta"]')?.textContent).toContain('A verba é paga diretamente à Meta.');
});
test('ADAS-26 campaign artifacts resolve the current canonical campaign without reopening a form',async()=>{
  screen=ui();const c=campaign(),f=fixture(thread([turn({artifacts:[{type:'campaign',campaign:{...c,draft:{...c.draft,headline:'Título antigo'}}}]})]));c.draft.headline='Título atual';f.props.overview.campaigns=[c];await screen.render(<MetaAdsAssistant {...f.props}/>);expect(screen.container.textContent).toContain('Título atual');expect(screen.container.textContent).not.toContain('Título antigo');expect(screen.container.textContent).toContain('99,00');expect(screen.container.querySelector('[aria-label="Nome da campanha"]')).toBeNull();
});
test('ADAS-33 automatic review acceptance uses exact reviewed terms version and stable explicit request identity',async()=>{
  screen=ui();const f=fixture(thread([turn({artifacts:[{type:'automation_review',review:policyReview}]})]));await screen.render(<MetaAdsAssistant {...f.props}/>);await act(async()=>(screen.container.querySelector('.mga-automation input[type=checkbox]') as HTMLInputElement).click());f.client.automation.mockResolvedValue(automatic);await screen.click('Aceitar política automática');const body=f.client.acceptAutomation.mock.calls[0][0];expect(body).toMatchObject({scope:policyReview.scope,limits:policyReview.limits,version:1,digest:'policy-digest',idempotencyKey:expect.any(String)});expect(screen.container.textContent).toContain('Modo atual: automático');expect(f.client.submit).not.toHaveBeenCalled();
});
test('ADAS-38 explicit return to manual revokes the accepted policy and preserves audit explanation',async()=>{
  screen=ui();const f=fixture();f.client.automation.mockResolvedValue(automatic);await screen.render(<MetaAdsAssistant {...f.props}/>);await screen.click('Voltar para aprovação manual');expect(f.client.manual.mock.calls[0][0]).toMatchObject({policyId:'p',version:1,idempotencyKey:expect.any(String)});expect(screen.container.textContent).toContain('Modo atual: aprovação manual');expect(f.client.submit).not.toHaveBeenCalled();
});
test('ADAS-47 persisted closed-day report is accessible outside chat and as the same grounded artifact',async()=>{
  screen=ui();const report:MetaAdsDailyReport={id:'r',accountId:'123',localDay:'2026-11-15',timezone:'America/Sao_Paulo',since:'2026-11-15T03:00:00Z',until:'2026-11-16T03:00:00Z',status:'partial',analysisStatus:'awaiting_data',collectedAt:null,updatedAt:'2026-11-16T03:01:00Z',campaigns:[],notes:['Coleta pendente de recuperação']};const f=fixture(thread([turn({artifacts:[{type:'daily_report',report}]})]));f.client.reports.mockResolvedValue({reports:[report]});await screen.render(<MetaAdsAssistant {...f.props}/>);expect(screen.container.querySelectorAll('.mga-daily-report')).toHaveLength(2);expect(screen.container.textContent).toContain('America/Sao_Paulo');expect(screen.container.textContent).toContain('Coleta pendente de recuperação');
});

test('ADAS-58 a slow older panel batch cannot overwrite the report returned by the latest refresh gesture',async()=>{
  screen=ui();const f=fixture();let finish!:(value:unknown)=>void;const funding=f.client.funding.getMockImplementation()!;
  f.client.funding.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const r=(id:string,day:string):MetaAdsDailyReport=>({id,accountId:'123',localDay:day,timezone:'America/Sao_Paulo',since:day,until:day,status:'completed',analysisStatus:'awaiting_data',collectedAt:null,updatedAt:'2026-11-17T03:01:00Z',campaigns:[],notes:[]});
  f.client.reports.mockResolvedValueOnce({reports:[r('old','2026-11-15')]}).mockResolvedValue({reports:[r('new','2026-11-16')]});
  await screen.render(<MetaAdsAssistant {...f.props}/>);await screen.click('Atualizar conversa');
  expect((screen.container.querySelector('[aria-label="Dia do relatório"]') as HTMLSelectElement).value).toBe('new');
  await act(async()=>finish(await funding()));expect((screen.container.querySelector('[aria-label="Dia do relatório"]') as HTMLSelectElement).value).toBe('new');expect(screen.container.querySelector('[aria-label="Dia do relatório"]')?.textContent).toContain('16/11/2026');
});
test('ADAS-18 history or source outage remains visible while independent financial guidance is preserved',async()=>{
  screen=ui();const f=fixture();f.client.thread.mockRejectedValue(new Error('offline'));await screen.render(<MetaAdsAssistant {...f.props}/>);expect(screen.container.textContent).toContain('Não foi possível carregar a conversa');expect(screen.container.textContent).toContain('Sem leitura financeira');expect(screen.container.textContent).toContain('pago diretamente à Meta');expect(f.client.submit).not.toHaveBeenCalled();f.client.thread.mockResolvedValue(thread([turn({reply:'Histórico recuperado'})]));await screen.click('Atualizar conversa');expect(screen.container.textContent).toContain('Histórico recuperado');
});
test('ADAS-14 a rejected stale revision refreshes state and allows a corrected next message',async()=>{
  screen=ui();const f=fixture();f.client.submit.mockRejectedValueOnce(new DashboardHttpError(409,'{"code":"assistant_revision_conflict"}'));await screen.render(<MetaAdsAssistant {...f.props}/>);
  f.client.thread.mockResolvedValue({...thread([turn({message:'Outro dispositivo',reply:'Histórico atualizado'})]),revision:2});await screen.change('Mensagem para a IA','Primeira intenção');await screen.click('Enviar mensagem');await screen.click('Atualizar conversa');await screen.change('Mensagem para a IA','Intenção corrigida');await screen.click('Enviar mensagem');expect(f.client.submit.mock.calls).toHaveLength(2);expect(f.client.submit.mock.calls[1][2]).toMatchObject({message:'Intenção corrigida',expectedRevision:2});expect(screen.container.textContent).toContain('Histórico atualizado');
});
test('ADAS-13 mobile source navigation dismisses the overlay and focuses the actual reader',async()=>{
  screen=ui();const previous=window.innerWidth;Object.defineProperty(window,'innerWidth',{value:390,configurable:true});
  try{const f=fixture(thread([turn({references:[{id:'funds:one',version:'1',title:'Como financiar anúncios',url:'/?tab=meta-ads-agent&help=funds',reviewedAt:'2026-11-16',excerpt:'Verba de mídia'}]})]));await screen.render(<MetaAdsAssistant {...f.props}/>);await screen.click('Abrir assistente');await screen.click('Ver fonte: Como financiar anúncios');expect((screen.container.querySelector('.chat-dock-panel') as HTMLElement).hidden).toBe(true);expect(document.activeElement?.textContent).toBe('Como financiar anúncios');expect(screen.container.querySelector('[aria-label="Fonte da resposta"]')).not.toBeNull();}
  finally{Object.defineProperty(window,'innerWidth',{value:previous,configurable:true});}
});
test('ADAS-30 policy read failure never falsely labels an unknown effective mode as manual',async()=>{
  screen=ui();const f=fixture();f.client.automation.mockRejectedValue(new Error('offline'));await screen.render(<MetaAdsAssistant {...f.props}/>);expect(screen.container.textContent).toContain('Modo atual: não confirmado');expect(screen.container.textContent).not.toContain('Modo atual: aprovação manual');expect(screen.container.textContent).toContain('Não foi possível confirmar a política atual');expect(Array.from(screen.container.querySelectorAll('button')).find(button=>button.textContent==='Automático')!.disabled).toBe(true);
});
