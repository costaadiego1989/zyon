// Type every character through Cypress without adding a human typing cadence.
Cypress.Keyboard.defaults({keystrokeDelay:0});
type NativeKeyboardEvidence={key:string;target:Record<string,unknown>;before:Record<string,unknown>;focused?:Record<string,unknown>;focusChecks:number;events:Array<Record<string,unknown>>;error?:string};
let nativeKeyboardEvidence:NativeKeyboardEvidence[]=[],nativeTestOrdinal=0;
beforeEach(()=>{nativeKeyboardEvidence=[];nativeTestOrdinal++;});
export const api=()=>String(Cypress.expose('agenticApi'));
export function scenario(id:string,title:string,run:()=>void){if(!Cypress.expose('agenticCase')||Cypress.expose('agenticCase')===id)it(`${id} ${title}`,run);}
export function control(path:string,body?:unknown){return cy.env(['agenticNonce'],{log:false}).then(({agenticNonce})=>cy.request({url:api()+'/__test/'+path,method:body===undefined?'GET':'POST',...(path==='workers'?{timeout:120000}:{}),headers:{'x-agentic-test-nonce':String(agenticNonce)},...(body===undefined?{}:{body})}));}
export function reset(){return control('reset',{});}
export function eventuallyFacts(check:(body:any)=>boolean,left=240):Cypress.Chainable<any>{return control('facts').then(({body})=>{if(check(body))return cy.wrap(body,{log:false});if(!left)throw Error('Persisted state did not reach the required condition');cy.wait(250,{log:false});return eventuallyFacts(check,left-1);});}
export function enter(){cy.intercept('GET','https://fonts.googleapis.com/**',{statusCode:200,headers:{'content-type':'text/css'},body:''});cy.visit('/');cy.contains('button','Entrar na loja de teste').click();cy.get('h1').should('contain.text','Anúncios com IA');cy.get('.chat-dock-composer textarea').should('exist');}
export function openChat(){cy.get('[aria-label="Abrir assistente"]').then(button=>{if(!button[0].hidden)cy.wrap(button).click();});}
export function closeChat(){cy.get('.chat-dock-panel').then(panel=>{if(!panel[0].hidden)cy.get('[aria-label="Recolher assistente"]').click();});}
/** Dispatch complete Chromium key data for native button activation and focus traversal. */
export function nativeKey(key:'Enter'|'Tab'|'Escape'|'ArrowLeft'|'ArrowRight'){
  const code={Enter:13,Tab:9,Escape:27,ArrowLeft:37,ArrowRight:39}[key],params={key,code:key,windowsVirtualKeyCode:code,nativeVirtualKeyCode:code};
  return cy.window({log:false}).then(win=>{
    const target=win.document.activeElement as HTMLElement;
    const focusState=()=>({documentFocused:win.document.hasFocus(),activeTarget:win.document.activeElement===target,connected:target?.isConnected===true,ownedDocument:target?.ownerDocument===win.document,submitEnabled:target?.closest('.chat-dock-composer')?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled===false});
    const trace:NativeKeyboardEvidence={key,target:{tag:target?.tagName,id:target?.id,label:target?.getAttribute('aria-label'),valueLength:target instanceof win.HTMLTextAreaElement?target.value.length:undefined},before:focusState(),focusChecks:0,events:[]};nativeKeyboardEvidence.push(trace);
    const seen:Array<{event:KeyboardEvent;sample:Record<string,unknown>}>=[];
    const observe=(event:KeyboardEvent)=>{seen.push({event,sample:{key:event.key,code:event.code,keyCode:event.keyCode,isTrusted:event.isTrusted,isComposing:event.isComposing,ctrlKey:event.ctrlKey,altKey:event.altKey,metaKey:event.metaKey,shiftKey:event.shiftKey,atTarget:event.target===target,documentFocused:win.document.hasFocus(),submitEnabled:focusState().submitEnabled,defaultPreventedAtCapture:event.defaultPrevented}});};
    const ready=()=>new Cypress.Promise<void>((resolve,reject)=>{
      const deadline=Date.now()+Number(Cypress.config('defaultCommandTimeout'));let stable=0;
      const frame=()=>{try{
        trace.focusChecks++;if(!(target instanceof win.HTMLElement)||!target.isConnected||target.ownerDocument!==win.document)throw Error('native_keyboard_target_changed');
        win.focus();target.focus({preventScroll:true});trace.focused=focusState();stable=trace.focused.documentFocused&&trace.focused.activeTarget?stable+1:0;
        if(stable>=2){resolve();return;}if(Date.now()>=deadline)throw Error('native_keyboard_document_focus_unavailable');win.requestAnimationFrame(frame);
      }catch(error){reject(error);}};frame();
    });
    return Cypress.automation('remote:debugger:protocol',{command:'Page.bringToFront',params:{}}).then(()=>Cypress.automation('remote:debugger:protocol',{command:'Emulation.setFocusEmulationEnabled',params:{enabled:true}})).then(ready).then(()=>{
      win.document.addEventListener('keydown',observe,{capture:true,passive:true});
      return Cypress.automation('remote:debugger:protocol',{command:'Input.dispatchKeyEvent',params:{type:key==='Enter'?'keyDown':'rawKeyDown',...params,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})}}).then(()=>Cypress.automation('remote:debugger:protocol',{command:'Input.dispatchKeyEvent',params:{type:'keyUp',...params}}));
    }).finally(()=>{win.document.removeEventListener('keydown',observe,true);trace.events=seen.map(({event,sample})=>({...sample,defaultPrevented:event.defaultPrevented}));}).then(()=>{
      expect(trace.events,'one delivered native keydown').have.length(1);const event=trace.events[0];
      expect(event,'trusted native key reaches the intended focused AUT target').include({key,isTrusted:true,isComposing:false,atTarget:true,documentFocused:true,ctrlKey:false,altKey:false,metaKey:false,shiftKey:false});
      if(key==='Enter'&&target.matches('.chat-dock-composer textarea'))expect(event.defaultPrevented,'composer React Enter handler received the key').eq(true);
    }).catch(error=>{trace.error=error instanceof Error?error.message:String(error);throw error;});
  });
}
export function ask(message:string){openChat();cy.get('.chat-dock-history').should('not.contain.text','Carregando conversa').then(history=>{
  const count=history.find('.chat-dock-turn').length;cy.get('[aria-label="Mensagem para a IA"]').clear().type(message);cy.contains('button','Enviar mensagem').click();
  cy.get('.chat-dock-turn',{timeout:120000}).should('have.length',count+1).last().find('.chat-dock-reply',{timeout:120000}).should('not.contain.text','Zyon pensando').and('not.contain.text','Este turno não foi concluído').and('not.contain.text','Resultado ainda desconhecido');
});}
afterEach(function(){
  const test=this.currentTest?.title;
  const saveKeyboard=()=>{if(!nativeKeyboardEvidence.length)return;const directory=String(Cypress.config('screenshotsFolder')).replace(/[\\/]screenshots[\\/]?$/,'');return cy.writeFile(`${directory}/native-keyboard-${nativeTestOrdinal}.json`,{test,spec:Cypress.spec.relative,state:this.currentTest?.state,events:nativeKeyboardEvidence},{log:false});};
  if(this.currentTest?.state==='failed')return control('facts').then(({body})=>cy.writeFile('../../.specs/features/agentic-dashboard-assistant/cypress-last-failed-facts.json',{test,...body,nativeKeyboardEvidence})).then(saveKeyboard);
  return saveKeyboard();
});
