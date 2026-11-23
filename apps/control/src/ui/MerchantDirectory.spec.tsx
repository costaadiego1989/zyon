import { beforeAll, expect, test, vi } from "vitest";
import { act } from "react";
import { MerchantDirectory } from "./MerchantDirectory.js";
import { PlatformApi, PlatformApiError, type PlatformMerchantDetail } from "../lib/api.js";
import { show } from "./prospecting/screen-test.js";
beforeAll(()=>{
  if(!HTMLDialogElement.prototype.showModal){
    Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value(){this.setAttribute('open','');}});
    Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value(){this.removeAttribute('open');}});
  }
});
const merchant={id:'company_a',name:'Mercado Aurora',store_slug:'aurora',plan:'BOTH' as const,member_count:1,created_at:'2026-11-01',updated_at:'2026-11-20'};
const detail:PlatformMerchantDetail={
  merchant:{id:merchant.id,name:merchant.name,plan:'BOTH',createdAt:merchant.created_at,registrationEmail:'titular@aurora.test',company:{cnpj:'00ABC345000135',razaoSocial:'Aurora Comércio Ltda',inscricaoEstadual:'ISENTO',email:'contato@aurora.test',phone:'+5511998765432',address:{street:'Rua Um',number:'10',city:'São Paulo',state:'SP',zip:'01001000'}}},
  period:{from:'2026-11-01',to:'2026-12-01'},orders:{allTimeCount:0,allTimeTotalMinor:0,periodCount:0,periodTotalMinor:0,series:[]},
  billing:{overdueCount:0,openReceivableCount:0},ai:{chatTokens:'0',voiceTokens:'0',chatKnownCostMicros:'0',voiceKnownCostMicros:'0',knownCostMicros:'0',unpricedEvents:0},recentOrders:[],
};
async function open(read:()=>Promise<PlatformMerchantDetail>=async()=>detail){
  const api={listMerchants:vi.fn().mockResolvedValue({items:[merchant],next_cursor:null}),getMerchantDetail:vi.fn(read)};
  const expired=vi.fn();
  const ui=await show(<MerchantDirectory api={api as unknown as PlatformApi} token="fixture" onSessionExpired={expired}/>);
  const trigger=ui.host.querySelector<HTMLButtonElement>('[aria-label="Abrir detalhes de Mercado Aurora"]')!;
  trigger.focus();await ui.click(trigger.textContent!.trim());
  return{ui,api,expired,trigger};
}
test('ADM-03 company click opens its side dialog with registration, contacts and retained metrics',async()=>{
  const{ui,api}=await open();
  const dialog=ui.host.querySelector('dialog[open]');expect(dialog).not.toBeNull();
  expect(api.getMerchantDetail.mock.calls[0]).toEqual(['fixture','company_a']);
  for(const value of ['Aurora Comércio Ltda','00.ABC.345/0001-35','contato@aurora.test','titular@aurora.test','(11) 99876-5432','Rua Um','São Paulo','ISENTO','Vendas no período'])expect(dialog?.textContent).toContain(value);
  for(const [label,email] of [['Email de contato','contato@aurora.test'],['Email do cadastro','titular@aurora.test']]){
    const term=Array.from(dialog!.querySelectorAll('.merchant-profile-facts dt')).find(node=>node.textContent===label)!;
    const value=term.nextElementSibling!;
    expect(value.textContent).toBe(email);expect(value.querySelector('a')?.textContent).toBe(email);
    expect(value.querySelector('a')?.getAttribute('href')).toBe('mailto:'+email);
  }
  await act(async()=>ui.host.querySelector<HTMLButtonElement>('[aria-label="Fechar detalhes"]')!.click());expect(ui.host.querySelector('dialog')).toBeNull();
});
test('ADM-03 contact and registration labels retain their own link when only one address exists',async()=>{
  for(const missing of ['contact','owner']){
    const expectedContact=missing==='contact'?undefined:'contato@aurora.test';
    const expectedOwner=missing==='owner'?undefined:'titular@aurora.test';
    const {ui}=await open(async()=>({...detail,merchant:{...detail.merchant,registrationEmail:expectedOwner,company:{...detail.merchant.company,email:expectedContact}}}));
    for(const [label,email] of [['Email de contato',expectedContact],['Email do cadastro',expectedOwner]]){
      const term=Array.from(ui.host.querySelectorAll('.merchant-profile-facts dt')).find(node=>node.textContent===label)!;
      const value=term.nextElementSibling!;
      expect(value.textContent).toBe(email??'Não informado');
      if(email){expect(value.querySelector('a')?.textContent).toBe(email);expect(value.querySelector('a')?.getAttribute('href')).toBe('mailto:'+email);}
      else expect(value.querySelector('a')).toBeNull();
    }
    await act(async()=>ui.host.querySelector<HTMLButtonElement>('[aria-label="Fechar detalhes"]')!.click());
  }
});
test('ADM-03 absent registration fields are identified instead of invented',async()=>{
  const{ui}=await open(async()=>({...detail,merchant:{id:'company_a',name:merchant.name,plan:'BOTH',createdAt:merchant.created_at}}));
  const facts=ui.host.querySelector('.merchant-profile-facts');expect(facts).not.toBeNull();
  for(const field of ['CNPJ','Email de contato','Telefone','Endereço']){
    const term=Array.from(facts!.querySelectorAll('dt')).find(x=>x.textContent===field)!;
    expect(term.nextElementSibling?.textContent).toBe('Não informado');
  }
});
test('ADM-03 preserves international phones and leading zeros in the document',async()=>{
  const{ui}=await open(async()=>({...detail,merchant:{...detail.merchant,company:{...detail.merchant.company,cnpj:'00000000000191',phone:'+12025550123'}}}));
  expect(ui.text()).toContain('00.000.000/0001-91');expect(ui.text()).toContain('+12025550123');
});
test('ADM-03 existing sales, AI and billing metrics retain their exact values',async()=>{
  const{ui}=await open(async()=>({...detail,
    orders:{allTimeCount:12,allTimeTotalMinor:9876543,periodCount:4,periodTotalMinor:123456,series:[]},
    ai:{chatTokens:'12345',voiceTokens:'6789',chatKnownCostMicros:'1230000',voiceKnownCostMicros:'4560000',knownCostMicros:'5790000',unpricedEvents:2},
    billing:{status:'active',amountMinor:44900,cycle:'monthly',overdueCount:0,openReceivableCount:0},
  }));
  for(const[label,value,annotation]of[
    ['Vendas no período','R$ 1.234,56','4 pedido(s)'],['Vendas totais','R$ 98.765,43','12 pedido(s)'],
    ['Tokens de chat','12.345','capturados no período'],['Tokens de voz','6.789','Realtime Mini'],
    ['Custo estimado de chat','US$ 1,23','DeepSeek no periodo'],['Custo estimado de voz','US$ 4,56','GPT Realtime Mini'],
    ['Total estimado de IA','US$ 5,79','2 evento(s) sem preço'],['Cobrança','active','R$ 449,00 / mês'],
  ]){
    const term=Array.from(ui.host.querySelectorAll('.detail-facts dt')).find(node=>node.textContent===label)!;
    expect(term.nextElementSibling?.textContent?.replace(/\s/g,' ')).toBe(value);
    expect(term.parentElement?.querySelector('small')?.textContent?.replace(/\s/g,' ')).toBe(annotation);
  }
});
test('ADM-03 pending detail shows its loading state before revealing the company profile',async()=>{
  let resolve!:(value:PlatformMerchantDetail)=>void;
  const pending=new Promise<PlatformMerchantDetail>(done=>{resolve=done;});
  const{ui}=await open(()=>pending);
  expect(ui.host.querySelector('[role=status]')?.textContent).toContain('Carregando dados da empresa');
  expect(ui.text()).not.toContain('contato@aurora.test');
  await act(async()=>resolve(detail));expect(ui.host.querySelector('[role=status]')).toBeNull();expect(ui.text()).toContain('contato@aurora.test');
});
test('ADM-03 failed detail can be retried and denied access does not show profile data',async()=>{
  const read=vi.fn<()=>Promise<PlatformMerchantDetail>>().mockRejectedValueOnce(new PlatformApiError(503)).mockResolvedValueOnce(detail);
  const{ui}=await open(read);expect(ui.host.querySelector('[role=alert]')).not.toBeNull();
  expect(ui.text()).not.toContain('contato@aurora.test');await ui.click('Tentar novamente');expect(ui.text()).toContain('contato@aurora.test');
  await act(async()=>ui.host.querySelector<HTMLButtonElement>('[aria-label="Fechar detalhes"]')!.click());
  const denied=await open(async()=>{throw new PlatformApiError(403);});
  expect(denied.ui.text()).toContain('Seu acesso não permite');expect(denied.ui.text()).not.toContain('contato@aurora.test');
});
