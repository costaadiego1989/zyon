// @vitest-environment jsdom
import {act} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {ui} from '../../pages/meta-ads-agent/test-helpers.js';
import {ChatDock} from './ChatDock.js';
let screen:ReturnType<typeof ui>;
afterEach(async()=>{await screen?.close();vi.useRealTimers();});
const context={id:'meta-ads',label:'Anúncios com IA',capabilities:[]};
const hints=['Posso explicar seus resultados.','Cada campanha precisa da sua aprovação.'];
test('FG-01 floating assistant starts collapsed with the existing mascot and opens through a real gesture',async()=>{
 screen=ui();await screen.render(<ChatDock presentation='floating' context={context} turns={[]} onSend={async()=>{}}/>);
 const panel=screen.container.querySelector('.chat-dock-panel') as HTMLElement;
 expect(panel.hidden).toBe(true);expect(screen.container.querySelector('.zyon-agent-orb__eyes')).not.toBeNull();
 await screen.click('Abrir assistente');expect(panel.hidden).toBe(false);expect(document.activeElement).toBe(screen.container.querySelector('textarea'));
});
test('FG-02 hints wait ten seconds, rotate without sending AI requests and pause while the panel is open',async()=>{
 vi.useFakeTimers();screen=ui();const send=vi.fn();await screen.render(<ChatDock presentation='floating' pageKey='metrics' hints={hints} context={context} turns={[]} onSend={send}/>);
 await act(async()=>vi.advanceTimersByTime(9999));expect(screen.container.querySelector('.chat-dock-hint')).toBeNull();
 await act(async()=>vi.advanceTimersByTime(1));expect(screen.container.querySelector('.chat-dock-hint')?.textContent).toContain(hints[0]);
 await act(async()=>vi.advanceTimersByTime(10000));expect(screen.container.querySelector('.chat-dock-hint')?.textContent).toContain(hints[1]);
 await screen.click('Abrir assistente');await act(async()=>vi.advanceTimersByTime(30000));expect(screen.container.querySelector('.chat-dock-hint')).toBeNull();expect(send).not.toHaveBeenCalled();
});
test('FG-03 page change discards the old hint, preserves the draft and explains only the current page',async()=>{
 vi.useFakeTimers();screen=ui();await screen.render(<ChatDock presentation='floating' pageKey='metrics' hints={hints} context={context} turns={[]} onSend={async()=>{}}/>);
 await screen.click('Abrir assistente');await screen.change('Mensagem para a IA','Minha campanha');await screen.click('Recolher assistente');
 await act(async()=>vi.advanceTimersByTime(10000));expect(screen.container.querySelector('.chat-dock-hint')?.textContent).toContain(hints[0]);
 await screen.render(<ChatDock presentation='floating' pageKey='settings' hints={['Vamos conferir os pagamentos.']} context={context} turns={[]} onSend={async()=>{}}/>);
 expect(screen.container.querySelector('.chat-dock-hint')).toBeNull();await act(async()=>vi.advanceTimersByTime(10000));expect(screen.container.querySelector('.chat-dock-hint')?.textContent).toContain('pagamentos');expect((screen.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Minha campanha');
});
test('FG-02 dismissing a hint keeps the launcher available and does not reopen it on the next interval',async()=>{
 vi.useFakeTimers();screen=ui();await screen.render(<ChatDock presentation='floating' hints={hints} context={context} turns={[]} onSend={async()=>{}}/>);await act(async()=>vi.advanceTimersByTime(10000));await screen.click('Dispensar dica');await act(async()=>vi.advanceTimersByTime(20000));expect(screen.container.querySelector('.chat-dock-hint')).toBeNull();await screen.click('Abrir assistente');expect((screen.container.querySelector('.chat-dock-panel') as HTMLElement).hidden).toBe(false);
});
