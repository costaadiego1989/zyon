import {api,ask,control,enter,reset,scenario} from '../../support/agentic.js';
describe('Runtime local real',()=>{
  beforeEach(()=>{reset();});
  scenario('ADAS-54','signed cookie, real API PG conversation RAG governance and measured usage',()=>{
    cy.request({url:api()+'/v1/merchant-assistant/contexts/meta-ads/thread',failOnStatusCode:false}).its('status').should('equal',401);
    cy.request({url:api()+'/__test/facts',failOnStatusCode:false}).its('status').should('equal',403);
    enter();ask('Como adiciono fundos para pagar os anúncios?');cy.get('.chat-dock-reply').last().should('contain.text','Meta');cy.get('.mga-chat-references button').first().click();cy.get('[aria-label="Fonte da resposta"]').should('be.visible');
    control('facts').then(({body})=>{expect(body.databaseHost).eq('127.0.0.1');expect(body.threads).eq(1);expect(body.turns).eq(1);expect(body.authSessions).greaterThan(0);expect(body.confirmedAiCostMicros).greaterThan(0);expect(body.governanceDecisions).greaterThan(0);expect(body.retrievedReferenceIds.length).greaterThan(0);expect(body.writes).deep.eq([]);expect(body.images).eq(0);});
  });
  scenario('ADAS-54','store gesture changes actual authenticated scope and denies the prior private thread',()=>{
    enter();ask('Mensagem privada da loja Aurora. Preciso de ajuda.');let previous='',calls=0;
    cy.request(api()+'/v1/merchant-assistant/contexts/meta-ads/thread').then(({body})=>{previous=body.id;expect(body.turns[0].message).contain('Mensagem privada');});
    control('facts').then(({body})=>{calls=body.modelCalls;});cy.get('[aria-label="Loja ativa"]').select('store-b');cy.contains('Conta da loja B').should('be.visible');cy.get('.chat-dock-history').should('not.contain.text','Mensagem privada');
    cy.then(()=>cy.request({url:api()+`/v1/merchant-assistant/contexts/meta-ads/threads/${previous}/turns`,failOnStatusCode:false})).then(response=>{expect([403,404]).include(response.status);expect(JSON.stringify(response.body)).not.contain('Mensagem privada');});
    control('facts').then(({body})=>{expect(body.modelCalls).eq(calls);expect(body.writes).deep.eq([]);});
  });
});
