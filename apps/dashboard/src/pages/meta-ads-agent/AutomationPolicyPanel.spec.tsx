// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import type { MetaAdsAutomationReview, MetaAdsAutomationState } from '@zyon/shared-types';
import { ui } from './test-helpers.js';
import { AutomationPolicyPanel } from './AutomationPolicyPanel.js';
let screen:ReturnType<typeof ui>;afterEach(async()=>screen?.close());
const review:MetaAdsAutomationReview={accountId:'100',connectionEpoch:1,version:1,digest:'digest-one',warnings:['Investimento pago à Meta'],scope:{variantIds:['v'],campaignIds:['c'],allowNewCampaigns:true,destination:'store',priority:'paid_sales',country:'BR',actions:['prepare','publish','pause','creative','budget']},limits:{currency:'BRL',cadence:'lifetime',campaignCeilingCents:10000,storeCeilingCents:20000,startsAt:'2026-11-16T12:00:00Z',endsAt:'2026-11-23T12:00:00Z'}};
const manual:MetaAdsAutomationState={mode:'manual',policy:null,committedCents:0,availableCents:null};
const automatic:MetaAdsAutomationState={mode:'automatic',policy:{...review,id:'p',acceptedBy:'owner',acceptedAt:'2026-11-16T12:00:00Z',revokedAt:null},committedCents:10000,availableCents:10000};
const props=()=>({accountId:'100',state:manual,onChooseAutomatic:vi.fn().mockResolvedValue(undefined),onAccept:vi.fn().mockResolvedValue(undefined),onManual:vi.fn().mockResolvedValue(undefined)});
const acknowledge=async()=>{await act(async()=>(screen.container.querySelector('input[type=checkbox]') as HTMLInputElement).click());};
test('ADAS-30 selecting Automatic only starts planning and manual remains the effective default',async()=>{
  screen=ui();const p=props();await screen.render(<AutomationPolicyPanel {...p}/>);expect(screen.container.textContent).toContain('Modo atual: aprovação manual');await screen.click('Configurar modo autônomo');expect(p.onChooseAutomatic).toHaveBeenCalledTimes(1);expect(p.onAccept).not.toHaveBeenCalled();expect(screen.container.textContent).toContain('Modo atual: aprovação manual');
});
test('ADAS-32 exact scope amounts cadence validity and explicit acknowledgement precede acceptance',async()=>{
  screen=ui();const p=props();await screen.render(<AutomationPolicyPanel {...p} review={review} productNames={{v:'Bolsa Aurora'}} campaignNames={{c:'Coleção'}}/>);
  for(const text of ['Bolsa Aurora','Coleção','Novas campanhas','Loja','Vendas pagas','BR','100,00','200,00','total do período','16/11/2026','23/11/2026','Publicar','Pausar','Alterar criativo','Alterar orçamento'])expect(screen.container.textContent).toContain(text);
  const accept=Array.from(screen.container.querySelectorAll('button')).find(x=>x.textContent==='Aceitar política automática')!;expect(accept.disabled).toBe(true);await acknowledge();await screen.click('Aceitar política automática');expect(p.onAccept.mock.calls[0]).toEqual([review]);
  await screen.render(<AutomationPolicyPanel {...p} state={automatic}/>);expect(screen.container.textContent).toContain('Modo atual: automático');expect(screen.container.textContent).toContain('Política 1');
});

test('ADAS-32 policy risks explain money and revocation without internal warning identifiers',async()=>{
  screen=ui();await screen.render(<AutomationPolicyPanel {...props()} review={{...review,warnings:['automatic_budget_control_verification_required','media_spend_separate_from_subscription','revocation_does_not_pause_ads']}}/>);
  const text=screen.container.textContent!;expect(text).toContain('controle financeiro');expect(text).toContain('pago diretamente à Meta');expect(text).toContain('não pausa anúncios');for(const code of ['automatic_budget_control_verification_required','media_spend_separate_from_subscription','revocation_does_not_pause_ads'])expect(text).not.toContain(code);expect((screen.container.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false);
});
test('ADAS-33 changing a review invalidates the previous acknowledgement and cannot accept an old digest',async()=>{
  screen=ui();const p=props();await screen.render(<AutomationPolicyPanel {...p} review={review}/>);await acknowledge();const changed={...review,version:2,digest:'changed',limits:{...review.limits,storeCeilingCents:15000}};await screen.render(<AutomationPolicyPanel {...p} review={changed}/>);
  expect((screen.container.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false);expect(p.onAccept).not.toHaveBeenCalled();await acknowledge();await screen.click('Aceitar política automática');expect(p.onAccept.mock.calls[0]).toEqual([changed]);expect(screen.container.textContent).toContain('150,00');
});
test('ADAS-38 revoke gesture preserves visibility of sent actions and only confirmed state returns to manual',async()=>{
  screen=ui();const p=props();await screen.render(<AutomationPolicyPanel {...p} state={automatic}/>);expect(screen.container.textContent).toContain('não desfaz');await screen.click('Voltar para aprovação manual');expect(p.onManual).toHaveBeenCalledTimes(1);
  await screen.render(<AutomationPolicyPanel {...p} state={{...manual,policy:{...automatic.policy!,revokedAt:'2026-11-16T12:01:00Z'}}}/>);expect(screen.container.textContent).toContain('Modo atual: aprovação manual');expect(screen.container.textContent).toContain('Histórico de ações já enviadas');
});
test('ADAS-48 foreign account review cannot be accepted and disabled configuration cannot start planning',async()=>{
  screen=ui();const p=props();await screen.render(<AutomationPolicyPanel {...p} accountId="200" review={review} disabled/>);expect(screen.container.querySelector('input[type=checkbox]')).toBeNull();expect(screen.container.textContent).not.toContain('200,00');expect(Array.from(screen.container.querySelectorAll('button')).find(b=>b.textContent==='Configurar modo autônomo')!.disabled).toBe(true);expect(p.onAccept).not.toHaveBeenCalled();
});
test('ADAS-33 acceptance failure keeps manual mode and the reviewed terms visible for safe recovery',async()=>{
  screen=ui();const p=props();p.onAccept.mockRejectedValue(new Error('conflict'));await screen.render(<AutomationPolicyPanel {...p} review={review}/>);await acknowledge();await screen.click('Aceitar política automática');expect(screen.container.querySelector('[role=alert]')?.textContent).toContain('confirmar');expect(screen.container.textContent).toContain('Modo atual: aprovação manual');expect(screen.container.textContent).toContain('100,00');expect(p.onManual).not.toHaveBeenCalled();
});
