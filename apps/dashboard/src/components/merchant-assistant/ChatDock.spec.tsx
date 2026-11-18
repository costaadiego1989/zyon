// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AssistantTurn } from '@zyon/shared-types';
import { ui } from '../../pages/meta-ads-agent/test-helpers.js';
import { ChatDock } from './ChatDock.js';
let screen: ReturnType<typeof ui>; afterEach(async () => screen?.close());
const context = {id:'inventory',label:'Estoque',capabilities:[]};
const turn: AssistantTurn = {id:'t',threadId:'h',ordinal:1,status:'completed',message:'Olá',reply:'Produto disponível',references:[],artifacts:[],error:null,createdAt:'2026-11-16T12:00:00Z',updatedAt:'2026-11-16T12:00:00Z'};

test('RD-01 unavailable sending preserves the draft without claiming processing and resumes once eligible',async()=>{
  screen=ui();const send=vi.fn(),retry=vi.fn();
  const props={context,turns:[],onSend:send,onRetry:retry,error:'Acesso indisponível'};
  await screen.render(<ChatDock {...props} disabled/>);await screen.change('Mensagem para a IA','Meu anúncio');
  expect((screen.container.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  expect(Array.from(screen.container.querySelectorAll('button')).find(b=>b.textContent==='Retomar envio')!.disabled).toBe(true);
  await act(async()=>screen.container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await screen.click('Retomar envio');expect(send).not.toHaveBeenCalled();expect(retry).not.toHaveBeenCalled();
  expect(screen.container.textContent).not.toContain('Processando');expect(screen.container.querySelector('textarea')!.value).toBe('Meu anúncio');
  await screen.render(<ChatDock {...props}/>);await screen.click('Enviar mensagem');
  expect(send).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledWith('Meu anúncio');expect(screen.container.querySelector('textarea')!.value).toBe('');
});

test('RD-03 sourced replies omit only exact validated markers while source controls and escaped text remain',async()=>{
  screen=ui();const reference={id:'verba-e-pagamentos:tipo',version:'2026-11-18.1',title:'Pagamentos',url:'/?help=verba-e-pagamentos',reviewedAt:'2026-11-18',excerpt:'Valor em aberto é uma dívida.'};
  const reply='R$ 100 em 7 dias [verba-e-pagamentos:tipo]. [99] [outra:fonte] <img src=x onerror=alert(1)>';
  const original={...turn,reply,references:[reference]};
  await screen.render(<ChatDock context={context} turns={[original]} onSend={async()=>{}} renderTurnDetails={item=><button type="button">Ver fonte: {item.references[0].title}</button>}/>);
  const shown=screen.container.querySelector('.chat-dock-reply p')!.textContent!;
  expect(shown).not.toContain('[verba-e-pagamentos:tipo]');expect(shown).toContain('R$ 100 em 7 dias');expect(shown).toContain('[99] [outra:fonte]');expect(shown).toContain('<img src=x onerror=alert(1)>');
  expect(screen.container.querySelector('img')).toBeNull();expect(screen.container.textContent).toContain('Ver fonte: Pagamentos');expect(original.reply).toBe(reply);expect(original.references).toEqual([reference]);
});
test('ADAS-15 the same dock mounts a second inert context with no ad capabilities', async () => {
  screen=ui(); await screen.render(<ChatDock context={context} turns={[]} onSend={async()=>{}} empty={<p>Consulte seu estoque</p>}/>);
  expect(screen.container.textContent).toContain('Estoque'); expect(screen.container.textContent).toContain('Consulte seu estoque'); expect(screen.container.textContent).not.toContain('Meta'); expect(screen.container.querySelector('textarea')).not.toBeNull();
});
test('ADAS-10 send gesture submits valid text once and clears only after admission', async () => {
  screen=ui(); let accepted!:()=>void; const send=vi.fn(()=>new Promise<void>(yes=>{accepted=yes;}));
  await screen.render(<ChatDock context={context} turns={[]} onSend={send}/>); await screen.change('Mensagem para a IA','  Quero ajuda  '); await screen.click('Enviar mensagem');
  expect(send.mock.calls[0]).toEqual(['Quero ajuda']); expect((screen.container.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>accepted()); expect((screen.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
});
test('ADAS-53 empty and oversized messages cannot be sent', async () => {
  screen=ui(); const send=vi.fn(); await screen.render(<ChatDock context={context} turns={[]} onSend={send}/>);
  await screen.change('Mensagem para a IA','   '); expect((screen.container.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  await screen.change('Mensagem para a IA','a'.repeat(8001)); await act(async()=>screen.container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))); expect(send).not.toHaveBeenCalled(); expect(screen.container.textContent).toContain('8000');
});
test('ADAS-13 keyboard collapse and reopen preserve draft and processing with predictable focus', async () => {
  screen=ui(); await screen.render(<ChatDock context={context} turns={[{...turn,status:'running',reply:null}]} busy onSend={async()=>{}}/>);
  const input=screen.container.querySelector('textarea')!; input.focus();
  await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  const trigger=screen.container.querySelector('[aria-label="Abrir assistente"]') as HTMLButtonElement; expect(document.activeElement).toBe(trigger);
  await screen.click('Abrir assistente'); expect(document.activeElement).toBe(screen.container.querySelector('textarea')); expect(screen.container.textContent).toContain('Processando'); expect(screen.container.textContent).toContain('Olá');
});

test('ADAS-13 sending from the keyboard returns focus before the focused submit control becomes disabled',async()=>{
  screen=ui();let admitted!:()=>void;const send=vi.fn(()=>new Promise<void>(yes=>{admitted=yes;}));await screen.render(<ChatDock context={context} turns={[]} onSend={send}/>);await screen.change('Mensagem para a IA','Ajuda por teclado');
  const button=screen.container.querySelector('button[type=submit]') as HTMLButtonElement;button.focus();await screen.click('Enviar mensagem');
  expect(button.disabled).toBe(true);expect(document.activeElement).toBe(screen.container.querySelector('textarea'));expect(send).toHaveBeenCalledTimes(1);
  await act(async()=>admitted());
});
test('ADAS-14 recoverable send error preserves draft and retry is an explicit gesture', async () => {
  screen=ui(); const retry=vi.fn(); const send=vi.fn().mockRejectedValue(new Error('offline'));
  await screen.render(<ChatDock context={context} turns={[]} onSend={send} onRetry={retry}/>); await screen.change('Mensagem para a IA','Não perder'); await screen.click('Enviar mensagem');
  expect((screen.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Não perder'); expect(screen.container.querySelector('[role=alert]')?.textContent).toContain('retomar'); await screen.click('Retomar envio'); expect(retry).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(1);
});

test('ADAS-13 retry returns focus before its control becomes disabled and before the request completes',async()=>{
  screen=ui();let resumed!:()=>void;const retry=vi.fn(()=>new Promise<void>(yes=>{resumed=yes;}));await screen.render(<ChatDock context={context} turns={[]} onSend={vi.fn().mockRejectedValue(new Error('offline'))} onRetry={retry}/>);await screen.change('Mensagem para a IA','Retomar por teclado');await screen.click('Enviar mensagem');
  const button=Array.from(screen.container.querySelectorAll('button')).find(button=>button.textContent==='Retomar envio')!;button.focus();await screen.click('Retomar envio');expect(document.activeElement).toBe(screen.container.querySelector('textarea'));expect(retry).toHaveBeenCalledTimes(1);await act(async()=>resumed());
});
test('ADAS-13 incoming replies do not steal focus and text remains escaped', async () => {
  screen=ui(); await screen.render(<ChatDock context={context} turns={[]} onSend={async()=>{}}/>); const input=screen.container.querySelector('textarea')!; input.focus();
  await screen.render(<ChatDock context={context} turns={[{...turn,reply:'<script>segredo</script>'}]} onSend={async()=>{}}/>);
  expect(document.activeElement).toBe(input); expect(screen.container.querySelector('script')).toBeNull(); expect(screen.container.textContent).toContain('<script>segredo</script>');
});
test('ADAS-09 loading history and contextual slots remain accessible without enabling duplicate submission', async () => {
  screen=ui(); await screen.render(<ChatDock context={context} turns={[turn]} loading onSend={async()=>{}} renderTurnDetails={t=><p>Artefato {t.id}</p>}/>);
  expect(screen.container.textContent).toContain('Carregando conversa'); expect(screen.container.textContent).toContain('Artefato t'); expect(screen.container.querySelector('[role=log]')).not.toBeNull(); expect((screen.container.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
});
