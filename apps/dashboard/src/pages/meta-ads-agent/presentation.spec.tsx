// @vitest-environment jsdom
import {act} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {ToastContainer} from '../../components/Toast.js';
import {useAction,executionFeedback} from './presentation.js';
import {ui} from './test-helpers.js';
let screen:ReturnType<typeof ui>;
afterEach(async()=>screen?.close());
function Action({work}:{work:()=>Promise<void>}){const action=useAction();return <><button onClick={()=>void action.run(work,'Rascunho salvo.')}>Salvar</button>{action.error&&<p role="alert">{action.error}</p>}</>;}
test('AF-05 explicit success and failure reach the existing dashboard toast with inline error retained',async()=>{screen=ui();const work=vi.fn().mockResolvedValue(undefined);await screen.render(<><ToastContainer/><Action work={work}/></>);await screen.click('Salvar');expect(screen.container.querySelector('.ui-toast--success')?.textContent).toContain('Rascunho salvo.');work.mockRejectedValue(new Error('network'));await screen.click('Salvar');expect(screen.container.querySelector('.ui-toast--error')?.textContent).toContain('Não foi possível confirmar');expect(screen.container.querySelectorAll('[role="alert"]')).toHaveLength(2);expect(work).toHaveBeenCalledTimes(2);});
test('AF-06 double gesture is locked and an unmounted action never announces another store result',async()=>{screen=ui();let finish!:()=>void;const work=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));await screen.render(<><ToastContainer/><Action work={work}/></>);await screen.click('Salvar');await screen.click('Salvar');expect(work).toHaveBeenCalledTimes(1);await screen.render(<ToastContainer/>);await act(async()=>finish());expect(screen.container.querySelector('.ui-toast')).toBeNull();});
test('AF-05 uncertain and queued execution feedback never claims publication',()=>{expect(executionFeedback({status:'execution_unknown'})).toEqual({type:'error',text:'Resultado desconhecido. Consulte o estado antes de qualquer nova ação.'});expect(executionFeedback({status:'publishing'})).toEqual({type:'success',text:'Publicação em processamento'});expect(executionFeedback({status:'failed'}).type).toBe('error');expect(executionFeedback({status:'reserved'}).text).toBe('Aguardando envio');});
