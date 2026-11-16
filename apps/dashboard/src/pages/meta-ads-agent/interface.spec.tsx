// @vitest-environment jsdom
import {act} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import type {MerchantAssistantApi} from '../../api/endpoints/merchant-assistant.js';
import type {MetaAdsAgentApi} from '../../api/endpoints/meta-ads-agent.js';
import {FundingPanel} from './FundingPanel.js';
import {AutomationPolicyPanel} from './AutomationPolicyPanel.js';
import {MetaAdsAgentPage} from './index.js';
import {overview} from './fixtures.js';
import {ui} from './test-helpers.js';
let screen:ReturnType<typeof ui>;afterEach(async()=>screen?.close());
test('ADAS-60 funding details are disclosed by a gesture while costs and official payment remain available',async()=>{
  screen=ui();await screen.render(<FundingPanel account={{id:'100',name:'Aurora'}} diagnosis={{status:'ready',message:'Consulta confirmada',error:null,nextSteps:[],snapshot:{accountId:'100',accountName:'Aurora',billingType:'prepaid',currency:'BRL',paymentMethod:'present',confirmedBlock:false,blockCode:null,amountDueCents:5000,prepaidAvailableCents:null,checkedAt:'2026-11-16T12:00:00Z',source:'meta_graph',paymentUrl:'https://business.facebook.com/latest/billing_hub/payment_settings/?payment_account_id=100&asset_id=100'}}} onRefresh={async()=>{}}/>);
  const details=screen.container.querySelector('details')!;expect(details).not.toBeNull();expect(details.open).toBe(false);
  expect(screen.container.querySelector('a')?.closest('details')).toBeNull();expect(screen.container.textContent).toContain('Sua assinatura da Zyon não inclui o investimento dos anúncios. Esse valor é pago diretamente à Meta.');
  await act(async()=>screen.container.querySelector('summary')!.click());expect(details.open).toBe(true);
  expect(details.textContent).toContain('Valor devido à Meta');expect(details.textContent).toContain('50,00');expect(details.textContent).toContain('Indisponível');expect(details.querySelector('time')?.dateTime).toBe('2026-11-16T12:00:00Z');
});
test('ADAS-61 manual automation starts compact and keeps the real policy-planning gesture',async()=>{
  screen=ui();const choose=vi.fn().mockResolvedValue(undefined);await screen.render(<AutomationPolicyPanel accountId="100" state={{mode:'manual',policy:null,committedCents:0,availableCents:null}} onChooseAutomatic={choose} onAccept={vi.fn()} onManual={vi.fn()}/>);
  expect(screen.container.querySelector('.mga-automation-summary')).not.toBeNull();expect(screen.container.textContent).toContain('Modo atual: aprovação manual');
  await screen.click('Automático');expect(choose).toHaveBeenCalledTimes(1);
});
test('ADAS-59 campaign workspace precedes secondary setup and its chat entry focuses without submitting',async()=>{
  screen=ui();const client={dispose:vi.fn(),thread:vi.fn().mockResolvedValue({id:'t',context:{id:'meta-ads',label:'Anúncios com IA',capabilities:[]},revision:0,campaign:null,turns:[],nextCursor:null,updatedAt:'2026-11-16'}),funding:vi.fn().mockResolvedValue({snapshot:null,status:'unknown',message:'Consulta indisponível',nextSteps:[],error:null}),automation:vi.fn().mockResolvedValue({mode:'manual',policy:null,version:0,committedCents:0,availableCents:null}),reports:vi.fn().mockResolvedValue({reports:[]}),submit:vi.fn()};
  await screen.render(<MetaAdsAgentPage merchantId="store" apiBaseUrl="https://api.example.test" api={{overview:vi.fn().mockResolvedValue(overview())} as unknown as MetaAdsAgentApi} assistantClient={client as unknown as MerchantAssistantApi}/>);
  const campaigns=screen.container.querySelector('[aria-labelledby="mga-campaigns-title"]')!,settings=Array.from(screen.container.querySelectorAll('summary')).find(s=>s.textContent==='Plano, preço e saldo de imagens')!;
  expect(campaigns.compareDocumentPosition(settings)&Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  await screen.click('Criar com a IA');expect(document.activeElement).toBe(screen.container.querySelector('[aria-label="Mensagem para a IA"]'));expect(client.submit).not.toHaveBeenCalled();
});
