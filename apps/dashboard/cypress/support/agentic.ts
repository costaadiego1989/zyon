export const api=()=>String(Cypress.expose('agenticApi'));
export function scenario(id:string,title:string,run:()=>void){if(!Cypress.expose('agenticCase')||Cypress.expose('agenticCase')===id)it(`${id} ${title}`,run);}
export function control(path:string,body?:unknown){return cy.env(['agenticNonce'],{log:false}).then(({agenticNonce})=>cy.request({url:api()+'/__test/'+path,method:body===undefined?'GET':'POST',headers:{'x-agentic-test-nonce':String(agenticNonce)},...(body===undefined?{}:{body})}));}
export function reset(){return control('reset',{});}
export function enter(){cy.visit('/');cy.contains('button','Entrar na loja de teste').click();cy.get('h1').should('contain.text','Anúncios com IA');cy.get('.chat-dock-composer textarea').should('exist');}
export function openChat(){cy.get('[aria-label="Abrir assistente"]').then(button=>{if(!button[0].hidden)cy.wrap(button).click();});}
export function ask(message:string){openChat();cy.get('[aria-label="Mensagem para a IA"]').clear().type(message);cy.contains('button','Enviar mensagem').click();cy.get('.chat-dock-turn').last().find('.chat-dock-reply').should('not.contain.text','Processando sua mensagem');}
