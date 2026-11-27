// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import type { MetaAdsFundingDiagnosis } from '@zyon/shared-types';
import { ui } from './test-helpers.js';
import { FundingPanel } from './FundingPanel.js';
let screen:ReturnType<typeof ui>;afterEach(async()=>screen?.close());
const account={id:'100',name:'Minha loja'};
test('AF-04 missing ad account is setup guidance, while failures on a selected account remain errors',async()=>{screen=ui();await screen.render(<FundingPanel account={null} error="Falha na consulta de pagamentos" onRefresh={async()=>{}}/>);expect(screen.container.textContent).toContain('Conecte e selecione sua conta de anúncios');expect(screen.container.querySelector('[role="alert"]')).toBeNull();await screen.render(<FundingPanel account={account} error="Falha na consulta de pagamentos" onRefresh={async()=>{}}/>);expect(screen.container.querySelector('[role="alert"]')?.textContent).toBe('Falha na consulta de pagamentos');});
const diagnosis=(billingType:'prepaid'|'postpaid'|'unknown'='prepaid'):MetaAdsFundingDiagnosis=>({status:'ready',message:'Leitura confirmada',nextSteps:[],error:null,snapshot:{accountId:'100',accountName:'Minha loja',currency:'BRL',billingType,paymentMethod:'present',confirmedBlock:false,blockCode:null,amountDueCents:5000,prepaidAvailableCents:null,checkedAt:'2026-11-16T12:34:00Z',source:'meta_graph',paymentUrl:'https://business.facebook.com/latest/billing_hub/payment_settings/?payment_account_id=100&asset_id=100&nav_ref=billing_hub&placement=campaign_manager'}});
test('ADAS-01 funding guidance separates media from subscription and image credits before any chat',async()=>{
  screen=ui();await screen.render(<FundingPanel account={account} diagnosis={diagnosis()} onRefresh={async()=>{}}/>);
  expect(screen.container.textContent).toContain('O investimento dos anúncios é pago diretamente à Meta.');
  expect(screen.container.textContent).toContain('pago diretamente à Meta');expect(screen.container.textContent).toContain('assinatura');expect(screen.container.textContent).toContain('créditos de imagens');expect(screen.container.querySelector('input')).toBeNull();
});
test('ADAS-05 payment gesture opens the official destination bound to this connected account',async()=>{
  screen=ui();await screen.render(<FundingPanel account={account} diagnosis={diagnosis()} onRefresh={async()=>{}}/>);
  const link=screen.container.querySelector('a')!;let opened='';link.addEventListener('click',e=>{e.preventDefault();opened=link.href;});link.click();
  expect(opened).toBe(diagnosis().snapshot!.paymentUrl);expect(link.target).toBe('_blank');expect(link.rel).toContain('noopener');expect(screen.container.textContent).toContain('Minha loja');expect(screen.container.textContent).toContain('Conta 100');
});
test('ADAS-03 postpaid accounts explain payment method and due amount without requiring a prepaid deposit',async()=>{
  screen=ui();await screen.render(<FundingPanel account={account} diagnosis={diagnosis('postpaid')} onRefresh={async()=>{}}/>);
  expect(screen.container.textContent).toContain('Pós-paga');expect(screen.container.textContent).toContain('método de pagamento');expect(screen.container.textContent).toContain('não exige recarga pré-paga');expect(screen.container.textContent).toMatch(/50,00/);expect(screen.container.textContent).not.toContain('Saldo pré-pago disponível');
});
test('ADAS-02 prepaid unknown balance stays unavailable and is never filled from amount due',async()=>{
  screen=ui();await screen.render(<FundingPanel account={account} diagnosis={diagnosis()} onRefresh={async()=>{}}/>);
  const row=Array.from(screen.container.querySelectorAll('dl > div')).find(x=>x.textContent?.includes('Saldo pré-pago disponível'))!;
  expect(row.textContent).toContain('Indisponível');expect(row.textContent).not.toContain('50,00');expect(screen.container.textContent).toContain('adicione fundos na Meta');
});
test('ADAS-04 unavailable diagnosis does not invent a zero balance and preserves help on refresh error',async()=>{
  screen=ui();const refresh=vi.fn().mockRejectedValue(new Error('offline'));
  await screen.render(<FundingPanel account={account} diagnosis={{snapshot:null,status:'unknown',message:'Sem leitura autorizada',nextSteps:[],error:'unavailable'}} onRefresh={refresh}/>);await screen.click('Verificar novamente');
  expect(screen.container.textContent).toContain('Não foi possível verificar os pagamentos desta conta');
  expect(refresh).toHaveBeenCalledTimes(1);expect(screen.container.textContent).toContain('Sem leitura autorizada');expect(screen.container.textContent).toContain('Não foi possível atualizar');expect(screen.container.textContent).not.toMatch(/0,00/);
});
test('ADAS-06 refresh only requests a new diagnosis and never acknowledges fictional credit',async()=>{
  screen=ui();const refresh=vi.fn().mockResolvedValue(undefined);await screen.render(<FundingPanel account={account} diagnosis={diagnosis()} onRefresh={refresh}/>);await screen.click('Verificar novamente');
  expect(refresh).toHaveBeenCalledTimes(1);expect(screen.container.textContent).toContain('pagamento não é confirmado por este botão');expect(screen.container.querySelector('time')?.dateTime).toBe('2026-11-16T12:34:00Z');expect(screen.container.textContent).toContain('Dados consultados na Meta');
});
test('ADAS-07 confirmed block explains publication restriction while funding destination and help remain usable',async()=>{
  screen=ui();const d=diagnosis();d.status='blocked';d.snapshot!.confirmedBlock=true;d.message='Método de pagamento ausente';
  await screen.render(<FundingPanel account={account} diagnosis={d} onRefresh={async()=>{}}/>);expect(screen.container.textContent).toContain('Publicação bloqueada');expect(screen.container.textContent).toContain('Método de pagamento ausente');expect(screen.container.querySelector('a')).not.toBeNull();
});
test('ADAS-08 foreign or invalid payment destinations and stale account snapshots cannot be used',async()=>{
  screen=ui();for(const url of ['https://evil.example/latest/billing_hub/payment_settings/?payment_account_id=100&asset_id=100','https://business.facebook.com/latest/billing_hub/payment_settings/?payment_account_id=200&asset_id=100','javascript:alert(1)']){
    const d=diagnosis();d.snapshot!.paymentUrl=url;await screen.render(<FundingPanel account={account} diagnosis={d} onRefresh={async()=>{}}/>);expect(screen.container.querySelector('a')).toBeNull();
  }
  await screen.render(<FundingPanel account={{id:'200',name:'Outra loja'}} diagnosis={diagnosis()} onRefresh={async()=>{}}/>);expect(screen.container.textContent).not.toContain('Minha loja');expect(screen.container.querySelector('a')).toBeNull();expect(screen.container.textContent).toContain('Outra loja');
});
