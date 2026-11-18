import {api,ask,control,enter,eventuallyFacts,reset,scenario} from '../../support/agentic.js';
describe('Runtime local real',()=>{
  beforeEach(()=>{reset();});
  scenario('ADAS-66','project segmented tabs retain canonical styles and native arrow navigation',()=>{
    enter();cy.get('[role="tablist"][aria-label="Seções de anúncios"]').should('have.class','tab-bar');
    cy.contains('[role="tab"]','Campanhas').should('have.css','border-radius','7px').and('have.css','font-weight','600');
    cy.contains('[role="tab"]','Campanhas').focus().type('{rightarrow}');cy.contains('[role="tab"]','Métricas').should('have.attr','aria-selected','true').and('be.focused');
    cy.get('[data-assistant-panel="metrics"]').should('be.visible');cy.get('.chat-dock').should('be.visible');control('facts').then(({body})=>{expect(body.turns).eq(0);expect(body.writes).deep.eq([]);});
  });
  scenario('ADAS-54','signed cookie, real API PG conversation RAG governance and measured usage',()=>{
    cy.request({url:api()+'/v1/merchant-assistant/contexts/meta-ads/thread',failOnStatusCode:false}).its('status').should('equal',401);
    cy.request({url:api()+'/__test/facts',failOnStatusCode:false}).its('status').should('equal',403);
    enter();ask('Como adiciono fundos para pagar os anúncios?');cy.get('.chat-dock-reply').last().should('contain.text','Meta');cy.get('.mga-chat-references > summary').first().click();cy.get('.mga-chat-references button').first().click();cy.get('[aria-label="Fonte da resposta"]').should('be.visible');
    control('facts').then(({body})=>{expect(body.databaseHost).eq('127.0.0.1');expect(body.threads).eq(1);expect(body.turns).eq(1);expect(body.authSessions).greaterThan(0);expect(body.confirmedAiCostMicros).greaterThan(0);expect(body.governanceDecisions).greaterThan(0);expect(body.retrievedReferenceIds.length).greaterThan(0);expect(body.writes).deep.eq([]);expect(body.images).eq(0);});
  });
  scenario('ADAS-54','store gesture changes actual authenticated scope and denies the prior private thread',()=>{
    enter();ask('Mensagem privada da loja Aurora. Preciso de ajuda.');let previous='',calls=0;
    cy.request(api()+'/v1/merchant-assistant/contexts/meta-ads/thread').then(({body})=>{previous=body.id;expect(body.turns[0].message).contain('Mensagem privada');});
    control('facts').then(({body})=>{calls=body.modelCalls;});cy.get('[aria-label="Loja ativa"]').select('store-b');cy.contains('Conta da loja B').should('be.visible');cy.get('.chat-dock-history').should('not.contain.text','Mensagem privada');
    cy.then(()=>cy.request({url:api()+`/v1/merchant-assistant/contexts/meta-ads/threads/${previous}/turns`,failOnStatusCode:false})).then(response=>{expect([403,404]).include(response.status);expect(JSON.stringify(response.body)).not.contain('Mensagem privada');});
    control('facts').then(({body})=>{expect(body.modelCalls).eq(calls);expect(body.writes).deep.eq([]);});
  });
  scenario('ADAS-54','ADAS-64 conversation follows new content and preserves manual reading and keyboard focus',()=>{
    enter();ask('Como adiciono fundos para pagar os anúncios?');ask('Como confiro os fundos dos anúncios na Meta?');
    const history='.chat-dock-history';cy.get(history).should(items=>{const el=items[0];expect(el.scrollHeight).greaterThan(el.clientHeight);expect(el.scrollTop+el.clientHeight).at.least(el.scrollHeight-2);});
    control('model',{hold:true});cy.get('[aria-label="Mensagem para a IA"]').type('Mais uma dúvida de pagamentos');cy.contains('button','Enviar mensagem').click();eventuallyFacts(body=>body.modelPending===1);
    cy.get(history).scrollTo('top');cy.get('[aria-label="Mensagem para a IA"]').focus();control('model',{hold:false});cy.get('.chat-dock-reply').last().should('not.contain.text','Processando sua mensagem');
    cy.get(history).should(items=>expect(items[0].scrollTop).eq(0));cy.get('[aria-label="Mensagem para a IA"]').should('be.focused');
    ask('Quero entender a verba dos anúncios.');cy.get(history).should(items=>{const el=items[0];expect(el.scrollTop+el.clientHeight).at.least(el.scrollHeight-2);});cy.get('[aria-label="Mensagem para a IA"]').should('be.focused');
  });
});
