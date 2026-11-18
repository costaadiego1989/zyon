// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import type { MetaAdsOverview } from "@zyon/shared-types";
import type { MerchantAssistantApi } from '../../api/endpoints/merchant-assistant.js';
import { MetaAdsAgentPage } from "./index.js";
import { campaign, overview, product, proposal,launchReview } from "./fixtures.js";
import { ui } from "./test-helpers.js";
import {ToastContainer} from '../../components/Toast.js';
let screen: ReturnType<typeof ui>;
afterEach(async () => screen?.close());
const apiFor = (data: MetaAdsOverview) => ({overview: vi.fn().mockResolvedValue(data), products: vi.fn().mockResolvedValue([product]), existing: vi.fn().mockResolvedValue([{id: "999", name: "Campanha existente", status: "ACTIVE"}]),existingMetrics:vi.fn(async(id:string,since:string,until:string)=>({campaignId:`existing-${id}`,since,until,updatedAt:'2026-11-18T12:00:00Z',timezone:'America/Sao_Paulo',currency:'BRL',source:'meta_reported',attributionWindow:'7d_click',spendCents:10000,attributedRevenueCents:40000,attributedPurchases:4,paidOrders:0,confirmedRevenueCents:null,conversations:5,costPerPurchaseCents:null,roas:4,contributionCents:null,costCoverage:'unavailable',stale:false,notes:[],reach:900,impressions:1200,linkClicks:40}))});
test('AGW-08 existing campaign results appear in their list without changing or opening the ad',async()=>{
 screen=ui();const data=overview(),api=apiFor(data);await screen.render(<MetaAdsAgentPage merchantId="store" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi} assistantClient={assistantClient() as unknown as MerchantAssistantApi}/>);
 await screen.click('Analisar campanhas existentes');const list=Array.from(screen.container.querySelectorAll('.mga-campaign-list')).find(el=>el.textContent?.includes('Campanha existente'))!;
 expect(list.textContent?.replace(/\u00a0/g,' ')).toContain('R$ 100,00');expect(list.textContent).toContain('Compras (Meta)4');expect(list.textContent).toContain('Conversas iniciadas5');expect(list.textContent).toContain('Contas alcançadas900');expect(list.textContent).toContain('Cliques no link40');
 expect(api.existingMetrics).toHaveBeenCalledTimes(1);expect(screen.container.querySelector('[aria-labelledby="insights-existing-999"]')).toBeNull();await screen.click('Analisar Campanha existente');expect(screen.container.querySelector('[aria-labelledby="insights-existing-999"]')).not.toBeNull();expect(api.existingMetrics).toHaveBeenCalledTimes(1);
});
test('AGW-05 campaign filter gestures combine actual status counts and search without writes',async()=>{
 screen=ui();const data=overview();data.campaigns=[{...campaign(),id:'running',status:'delivered',draft:{...campaign().draft,name:'Bolsas em veiculação'}},{...campaign(),id:'paused',status:'remote_paused',draft:{...campaign().draft,name:'Bolsas pausadas'}},{...campaign(),id:'review',draft:{...campaign().draft,name:'Bolsas para revisão'}}];data.proposals=[{...proposal(),kind:'launch',campaignId:'review'}];const api=apiFor(data);
 await screen.render(<MetaAdsAgentPage merchantId="store" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi} assistantClient={assistantClient() as unknown as MerchantAssistantApi}/>);
 await screen.click('Em veiculação (1)');expect(screen.container.querySelector('.mga-campaign-list')!.textContent).toContain('Bolsas em veiculação');expect(screen.container.querySelector('.mga-campaign-list')!.textContent).not.toContain('Bolsas pausadas');
 await screen.click('Pausadas (1)');expect(screen.container.querySelector('.mga-campaign-list')!.textContent).toContain('Bolsas pausadas');
 await screen.click('Aguardando aprovação (1)');expect(screen.container.querySelector('.mga-campaign-list')!.textContent).toContain('Bolsas para revisão');
 await screen.change('Buscar campanhas','inexistente');expect(screen.container.textContent).toContain('Nenhuma campanha neste filtro');
 expect(api.overview).toHaveBeenCalledTimes(1);expect(api.existing).not.toHaveBeenCalled();
});
test('AGW-06 opening a pending campaign displays its real review and creatives without approving',async()=>{
 screen=ui();const review=launchReview(),data=overview();data.campaigns=[review.campaign];data.proposals=[review.proposal];
 const read=vi.fn(async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).includes('/launch-review')?review:String(input).includes('/preparation')?{campaignDigest:'a'.repeat(64),preparations:[]}:{phoneNumber:null,consented:false,version:0}),{status:200,headers:{'Content-Type':'application/json'}}));const previous=globalThis.fetch;globalThis.fetch=read;
 try{await screen.render(<MetaAdsAgentPage merchantId="store" apiBaseUrl="https://api.example.test" api={apiFor(data) as unknown as MetaAdsAgentApi} assistantClient={assistantClient() as unknown as MerchantAssistantApi}/>);await screen.click('Aguardando aprovação (1)');await screen.click('Abrir campanha Coleção Aurora');
 const panel=screen.container.querySelector('[aria-label="Preparo e aprovação"]')!;expect(panel.textContent).toContain('Aprovar e publicar');expect(panel.querySelectorAll('img')).toHaveLength(2);expect(panel.querySelectorAll('img')[0].getAttribute('src')).toBe(review.media[0].url);
 expect(read.mock.calls.some(([url])=>String(url).includes('/campaigns/campaign1/launch-review'))).toBe(true);expect(read.mock.calls.some(([url])=>String(url).includes('/approve-launch'))).toBe(false);
 }finally{globalThis.fetch=previous;}
});
test('AF-05 analysis empty, failure and unconnected gestures use toasts without extra dispatch',async()=>{screen=ui();const api=apiFor(overview());api.existing.mockResolvedValue([]);const client=assistantClient();await screen.render(<><ToastContainer/><MetaAdsAgentPage assistantClient={client as unknown as MerchantAssistantApi} merchantId="store" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/></>);expect(screen.container.querySelector('.ui-toast')).toBeNull();await screen.click('Analisar campanhas existentes');expect(screen.container.querySelector('.ui-toast--success')?.textContent).toContain('Consulta concluída. Nenhuma campanha encontrada.');api.existing.mockRejectedValue(new Error('network'));await screen.click('Analisar campanhas existentes');expect(screen.container.querySelector('.ui-toast--error')?.textContent).toContain('Não foi possível confirmar');const data=overview();data.connection.account=null;api.overview.mockResolvedValue(data);await screen.click('Atualizar dados');await screen.click('Analisar campanhas existentes');expect(api.existing).toHaveBeenCalledTimes(2);expect(Array.from(screen.container.querySelectorAll('.ui-toast--error')).at(-1)?.textContent).toContain('Conecte sua conta de anúncios em Configurações');});
const assistantClient=(reply='')=>({dispose:vi.fn(),thread:vi.fn().mockResolvedValue({id:'thread',context:{id:'meta-ads',label:'Anúncios com IA',capabilities:[]},revision:0,campaign:null,turns:reply?[{id:'turn',threadId:'thread',ordinal:1,status:'completed',message:'Ajuda',reply,references:[],artifacts:[],error:null,createdAt:'2026-11-16',updatedAt:'2026-11-16'}]:[],nextCursor:null,updatedAt:'2026-11-16'}),funding:vi.fn().mockResolvedValue({snapshot:null,status:'unknown',message:'Leitura financeira indisponível',nextSteps:[],error:null}),automation:vi.fn().mockResolvedValue({mode:'manual',policy:null,version:0,committedCents:0,availableCents:null}),reports:vi.fn().mockResolvedValue({reports:[]})});
test('AF-04 analysis without an ad account explains setup without dispatching a doomed request',async()=>{screen=ui();const data=overview();data.connection.account=null;const api=apiFor(data);await screen.render(<MetaAdsAgentPage assistantClient={assistantClient() as unknown as MerchantAssistantApi} merchantId="store1" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/>);await screen.click('Analisar campanhas existentes');expect(api.existing).not.toHaveBeenCalled();expect(screen.container.textContent).toContain('Conecte sua conta de anúncios em Configurações para analisar campanhas.');});
test('AF-04 authorized empty analysis is an ordinary empty result',async()=>{screen=ui();const api=apiFor(overview());api.existing.mockResolvedValue([]);const client=assistantClient();client.funding.mockResolvedValue({status:'ready',message:'Leitura confirmada',nextSteps:[],error:null,snapshot:{accountId:'123',accountName:'Loja',currency:'BRL',billingType:'postpaid',paymentMethod:'present',confirmedBlock:false,blockCode:null,amountDueCents:0,prepaidAvailableCents:null,checkedAt:'2026-11-18T12:00:00Z',source:'meta_graph',paymentUrl:null}} as never);await screen.render(<MetaAdsAgentPage assistantClient={client as unknown as MerchantAssistantApi} merchantId="store1" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/>);await screen.click('Analisar campanhas existentes');expect(api.existing).toHaveBeenCalledTimes(1);expect(screen.container.textContent).toContain('Nenhuma campanha autorizada encontrada');expect(screen.container.textContent).not.toContain('Não foi possível confirmar');});
test("MGA-69 empty state offers real first-campaign and existing-analysis gestures", async () => {
  screen = ui(); const api = apiFor(overview());
  await screen.render(<MetaAdsAgentPage assistantClient={assistantClient() as unknown as MerchantAssistantApi} merchantId="store1" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/>);
  expect(screen.container.textContent).toContain("Sua primeira campanha começa aqui");
  await screen.click("Preparar primeira campanha"); expect(screen.container.querySelector('[aria-label="Nome da campanha"]')).not.toBeNull();
  await screen.click("Analisar campanhas existentes"); expect(screen.container.textContent).toContain("Campanha existente"); expect(screen.container.textContent).toContain("Somente análise");
});
test("MGA-70 loading is visible and a pending proposal cannot be sent twice", async () => {
  screen = ui(); const data = overview(); data.campaigns = [{...campaign(),remoteCampaignId:'999',status:'remote_paused'}]; let loaded!: (d: MetaAdsOverview) => void; let proposed!: (p: ReturnType<typeof proposal>) => void;
  const api = {...apiFor(data), overview: vi.fn(() => new Promise<MetaAdsOverview>(yes => {loaded = yes;})), propose: vi.fn(() => new Promise<ReturnType<typeof proposal>>(yes => {proposed = yes;}))};
  await screen.render(<MetaAdsAgentPage assistantClient={assistantClient() as unknown as MerchantAssistantApi} merchantId="store1" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/>);
  expect(screen.container.querySelector('[role="status"]')?.textContent).toContain("Carregando");
  await act(async () => {loaded(data);}); api.overview.mockResolvedValue(data);
  await screen.click("Abrir campanha Coleção Aurora"); await screen.change("Motivo da alteração", "Revisar estrutura"); await screen.click("Criar proposta");
  expect((screen.container.querySelector('[data-action="propose"]') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.container.textContent).toContain("Preparando proposta"); expect(api.propose).toHaveBeenCalledTimes(1);
  await act(async () => {proposed(proposal());}); expect(screen.container.textContent).toContain("Proposta criada para revisão");
});
test("MGA-71 failed saves and overview recovery retain the edited saved campaign", async () => {
  screen = ui(); const data = overview(); data.campaigns = [campaign()]; const api = {...apiFor(data), saveCampaign: vi.fn().mockRejectedValue(new Error("offline"))};
  await screen.render(<MetaAdsAgentPage assistantClient={assistantClient() as unknown as MerchantAssistantApi} merchantId="store1" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/>);
  await screen.click("Abrir campanha Coleção Aurora"); await screen.click("Editar campanha"); await screen.change("Nome da campanha", "Nome preservado"); await screen.click("Salvar rascunho");
  expect((screen.container.querySelector('[aria-label="Nome da campanha"]') as HTMLInputElement).value).toBe("Nome preservado");
  api.overview.mockRejectedValueOnce(new Error("offline")); await screen.click("Atualizar dados");
  expect(screen.container.textContent).toContain("Não foi possível atualizar"); expect((screen.container.querySelector('[aria-label="Nome da campanha"]') as HTMLInputElement).value).toBe("Nome preservado");
  await screen.click("Tentar atualizar novamente"); expect(screen.container.textContent).not.toContain("Não foi possível atualizar"); expect((screen.container.querySelector('[aria-label="Nome da campanha"]') as HTMLInputElement).value).toBe("Nome preservado");
});
test("changing active store discards a late response from the previous merchant", async () => {
  screen = ui(); let old!: (d: MetaAdsOverview) => void; const first = {...apiFor(overview()), overview: vi.fn(() => new Promise<MetaAdsOverview>(yes => {old = yes;}))}; const next = overview(); next.wallet.monthlyAvailable = 7;
  await screen.render(<MetaAdsAgentPage assistantClient={assistantClient() as unknown as MerchantAssistantApi} merchantId="old" apiBaseUrl="https://api.example.test" api={first as unknown as MetaAdsAgentApi}/>);
  await screen.render(<MetaAdsAgentPage assistantClient={assistantClient() as unknown as MerchantAssistantApi} merchantId="next" apiBaseUrl="https://api.example.test" api={apiFor(next) as unknown as MetaAdsAgentApi}/>);
  const stale = overview(); stale.campaigns = [campaign()]; await act(async () => old(stale));
  expect(screen.container.textContent).not.toContain("Coleção Aurora"); expect(screen.container.textContent).toContain("Sua primeira campanha começa aqui"); expect(screen.container.textContent).toContain("Imagens do mês disponíveis7");
});
test("a prepared campaign offers a separate publication proposal after refreshed remote state", async () => {
  screen = ui(); const data = overview(); data.campaigns = [campaign()]; const api = {...apiFor(data), propose: vi.fn().mockResolvedValue(proposal())};
  await screen.render(<MetaAdsAgentPage assistantClient={assistantClient() as unknown as MerchantAssistantApi} merchantId="store1" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/>);
  await screen.click("Abrir campanha Coleção Aurora");
  api.overview.mockResolvedValue({...data, campaigns: [{...campaign(), remoteCampaignId: "999", status: "remote_paused"}]});
  await screen.click("Atualizar dados");
  expect((screen.container.querySelector('[aria-label="Alteração"]') as HTMLSelectElement).value).toBe("publish");
  await screen.change("Motivo da alteração", "Publicar após revisão"); await screen.click("Criar proposta");
  expect(api.propose.mock.calls[0][1].kind).toBe("publish");
});
test('ADAS-09 page composes visible funding and reserved chat while preserving the manual campaign gesture',async()=>{
  screen=ui();const data=overview();await screen.render(<MetaAdsAgentPage merchantId="store" apiBaseUrl="https://api.example.test" api={apiFor(data) as unknown as MetaAdsAgentApi} assistantClient={assistantClient() as unknown as MerchantAssistantApi}/>);
  expect(screen.container.querySelector('.mga-agentic-content [aria-label="Verba dos anúncios"]')).not.toBeNull();expect(screen.container.querySelector('.mga-agentic-shell > .chat-dock')).not.toBeNull();expect(screen.container.textContent).toContain('Modo atual: aprovação manual');await screen.click('Preparar primeira campanha');expect(screen.container.querySelector('[aria-label="Nome da campanha"]')).not.toBeNull();expect(screen.container.querySelector('[aria-label="Mensagem para a IA"]')).not.toBeNull();
});
test('ADAS-30 page copy reflects confirmed automatic policy instead of promising individual approval',async()=>{
  screen=ui();const data=overview(),client=assistantClient();client.automation.mockResolvedValue({mode:'automatic',policy:{id:'policy',version:1,accountId:'123',connectionEpoch:1,scope:{variantIds:['variant1'],campaignIds:[],allowNewCampaigns:true,destination:'store',priority:'paid_sales',country:'BR',actions:['pause']},limits:{currency:'BRL',cadence:'lifetime',campaignCeilingCents:10000,storeCeilingCents:10000,startsAt:'2026-11-16T12:00:00Z',endsAt:'2026-11-23T12:00:00Z'},digest:'accepted',acceptedBy:'owner',acceptedAt:'2026-11-16T12:00:00Z',revokedAt:null},version:1,committedCents:0,availableCents:10000});
  await screen.render(<MetaAdsAgentPage merchantId="store" apiBaseUrl="https://api.example.test" api={apiFor(data) as unknown as MetaAdsAgentApi} assistantClient={client as unknown as MerchantAssistantApi}/>);expect(screen.container.querySelector('[aria-label="Autonomia dos anúncios"]')?.textContent).toContain('Modo atual: automático');expect(screen.container.querySelector('.mga-page-heading')?.textContent).not.toContain('cada decisão sob sua aprovação');
});
test('ADAS-12 page store switch clears previous assistant messages before its pending read returns',async()=>{
  screen=ui();const old=assistantClient();let release!:(value:unknown)=>void;old.thread.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));await screen.render(<MetaAdsAgentPage merchantId="old" apiBaseUrl="https://api.example.test" api={apiFor(overview()) as unknown as MetaAdsAgentApi} assistantClient={old as unknown as MerchantAssistantApi}/>);
  await screen.render(<MetaAdsAgentPage merchantId="new" apiBaseUrl="https://api.example.test" api={apiFor(overview()) as unknown as MetaAdsAgentApi} assistantClient={assistantClient('Contexto novo') as unknown as MerchantAssistantApi}/>);await act(async()=>release(await assistantClient('Histórico privado antigo').thread()));expect(screen.container.textContent).toContain('Contexto novo');expect(screen.container.textContent).not.toContain('Histórico privado antigo');expect(old.dispose).toHaveBeenCalledTimes(1);
});
