// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { MetaAdsAgentApi } from '../../api/endpoints/meta-ads-agent.js';
import { ui } from './test-helpers.js';
import { campaign,overview,proposal } from './fixtures.js';
import { CampaignChatArtifact } from './CampaignChatArtifact.js';
let screen:ReturnType<typeof ui>;afterEach(async()=>screen?.close());
const props=()=>({campaign:campaign(),overview:overview(),api:{} as MetaAdsAgentApi,onUpdated:vi.fn().mockResolvedValue(undefined),onRequest:vi.fn().mockResolvedValue(undefined)});
test('ADAS-26 campaign review shows canonical products stock price texts priority region and budget without a form',async()=>{
  screen=ui();await screen.render(<CampaignChatArtifact {...props()}/>);for(const text of ['Bolsa Aurora','BA1','99,00','Estoque: 5','Vendas pagas','Loja','BR','20,00','diário','Conheça a coleção'])expect(screen.container.textContent).toContain(text);expect(screen.container.querySelector('input[type=text]')).toBeNull();
});
test('ADAS-25 missing budget prevents preparation and asks to finish the planning in conversation',async()=>{
  screen=ui();const p=props();p.campaign.draft.budget=null;await screen.render(<CampaignChatArtifact {...p}/>);expect(screen.container.textContent).toContain('Esclareça o orçamento');expect(Array.from(screen.container.querySelectorAll('button')).find(b=>b.textContent==='Solicitar preparo pausado')!.disabled).toBe(true);expect(screen.container.textContent).not.toContain('0,00');
});
test('ADAS-28 image request uses actual credits once and exposes pending generation without buying extras',async()=>{
  screen=ui();const p=props();const generate=vi.fn().mockResolvedValue({id:'g',campaignId:p.campaign.id,requestedImages:1,status:'reserved',mediaIds:[],error:null,createdAt:'2026-11-16',updatedAt:'2026-11-16'});p.api={generate} as unknown as MetaAdsAgentApi;
  await screen.render(<CampaignChatArtifact {...p}/>);await screen.click('Gerar criativos');expect(generate.mock.calls[0][0]).toBe(p.campaign.id);expect(generate.mock.calls[0][1]).toBe(1);expect(typeof generate.mock.calls[0][2]).toBe('string');expect(screen.container.textContent).toContain('Geração na fila');expect(Array.from(screen.container.querySelectorAll('button')).find(b=>b.textContent==='Gerar criativos')!.disabled).toBe(true);expect(p.onUpdated).toHaveBeenCalledTimes(1);
});
test('ADAS-14 network retry preserves generation identity rather than charging a new request',async()=>{
  screen=ui();const p=props();const generate=vi.fn().mockRejectedValue(new Error('lost'));p.api={generate} as unknown as MetaAdsAgentApi;await screen.render(<CampaignChatArtifact {...p}/>);await screen.click('Gerar criativos');await screen.click('Gerar criativos');expect(generate.mock.calls[0][2]).toBe(generate.mock.calls[1][2]);expect(screen.container.querySelector('[role=alert]')).not.toBeNull();
});
test('ADAS-29 preparation creates a reviewable paused proposal and publication is a separate intent',async()=>{
  screen=ui();const p=props();p.campaign.draft.mediaIds=['m'];const prepare={...proposal(),kind:'prepare' as const,status:'pending_review' as const};const propose=vi.fn().mockResolvedValue(prepare);p.api={propose} as unknown as MetaAdsAgentApi;
  await screen.render(<CampaignChatArtifact {...p}/>);await screen.click('Solicitar preparo pausado');expect(propose.mock.calls[0][1].kind).toBe('prepare');expect(screen.container.textContent).toContain('Nenhuma alteração enviada');expect(screen.container.textContent).toContain('Aprovar alteração');expect(screen.container.textContent).not.toContain('Solicitar publicação');
  await screen.render(<CampaignChatArtifact key="remote" {...p} campaign={{...p.campaign,remoteCampaignId:'200',status:'remote_paused'}}/>);expect(screen.container.textContent).toContain('Solicitar publicação');
});
test('ADAS-31 manual proposal still requires the exact digest acknowledgement before execution',async()=>{
  screen=ui();const p=props();p.overview.proposals=[proposal()];const approve=vi.fn().mockResolvedValue({...proposal(),status:'approved',approvedBy:'owner',approvedAt:'2026-11-16'}),execute=vi.fn();p.api={approve,execute} as unknown as MetaAdsAgentApi;
  await screen.render(<CampaignChatArtifact {...p}/>);expect((screen.container.querySelector('[data-action=approve]') as HTMLButtonElement).disabled).toBe(true);await act(async()=>(screen.container.querySelector('.mga-ack input') as HTMLInputElement).click());await screen.click('Aprovar publicação');expect(approve).toHaveBeenCalledWith('proposal1','digest1');expect(execute).not.toHaveBeenCalled();expect(screen.container.textContent).toContain('Executar alteração aprovada');
});
test('ADAS-50 unknown execution or image result blocks new generation and proposals without claiming delivery',async()=>{
  screen=ui();const p=props();p.overview.executions=[{id:'e',proposalId:'p',campaignId:p.campaign.id,status:'execution_unknown',objects:[],error:'timeout',updatedAt:'2026-11-16'}];await screen.render(<CampaignChatArtifact {...p}/>);expect(screen.container.textContent).toContain('Resultado desconhecido');expect(screen.container.textContent).not.toContain('Veiculação confirmada');expect(Array.from(screen.container.querySelectorAll('button')).find(b=>b.textContent==='Solicitar preparo pausado')!.disabled).toBe(true);
  p.overview.executions=[];p.overview.generations=[{id:'g',campaignId:p.campaign.id,requestedImages:1,status:'unknown',mediaIds:[],error:'unknown',createdAt:'2026-11-16',updatedAt:'2026-11-16'}];await screen.render(<CampaignChatArtifact {...p}/>);expect(screen.container.textContent).toContain('Geração com resultado desconhecido');expect(Array.from(screen.container.querySelectorAll('button')).find(b=>b.textContent==='Gerar criativos')!.disabled).toBe(true);
});
test('ADAS-28 no credits and an external campaign never offer a spending gesture',async()=>{
  screen=ui();const p=props();p.overview.wallet.monthlyAvailable=0;await screen.render(<CampaignChatArtifact {...p}/>);expect(Array.from(screen.container.querySelectorAll('button')).find(b=>b.textContent==='Gerar criativos')!.disabled).toBe(true);
  await screen.render(<CampaignChatArtifact {...p} campaign={{...p.campaign,createdByAgent:false,managed:false}}/>);expect(screen.container.textContent).toContain('Somente leitura');expect(screen.container.querySelector('button')).toBeNull();
});
