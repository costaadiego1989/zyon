export const api=()=>String(Cypress.expose('agenticApi'));
export function scenario(id:string,title:string,run:()=>void){if(!Cypress.expose('agenticCase')||Cypress.expose('agenticCase')===id)it(`${id} ${title}`,run);}
export function control(path:string,body?:unknown){return cy.env(['agenticNonce'],{log:false}).then(({agenticNonce})=>cy.request({url:api()+'/__test/'+path,method:body===undefined?'GET':'POST',headers:{'x-agentic-test-nonce':String(agenticNonce)},...(body===undefined?{}:{body})}));}
export function reset(){return control('reset',{});}
export function eventuallyFacts(check:(body:any)=>boolean,left=80):Cypress.Chainable<any>{return control('facts').then(({body})=>{if(check(body))return cy.wrap(body,{log:false});if(!left)throw Error('Persisted state did not reach the required condition');cy.wait(250,{log:false});return eventuallyFacts(check,left-1);});}
export function enter(){cy.visit('/');cy.contains('button','Entrar na loja de teste').click();cy.get('h1').should('contain.text','Anúncios com IA');cy.get('.chat-dock-composer textarea').should('exist');}
export function openChat(){cy.get('[aria-label="Abrir assistente"]').then(button=>{if(!button[0].hidden)cy.wrap(button).click();});}
export function ask(message:string){openChat();cy.get('.chat-dock-history').then(history=>{
  const count=history.find('.chat-dock-turn').length;cy.get('[aria-label="Mensagem para a IA"]').clear().type(message);cy.contains('button','Enviar mensagem').click();
  cy.get('.chat-dock-turn').should('have.length',count+1).last().find('.chat-dock-reply').should('not.contain.text','Processando sua mensagem').and('not.contain.text','Este turno não foi concluído').and('not.contain.text','Resultado ainda desconhecido');
});}
