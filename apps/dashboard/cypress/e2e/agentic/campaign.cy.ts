import {api,ask,control,enter,reset,scenario} from '../../support/agentic.js';
const refreshReview=()=>{control('workers',{});cy.contains('button','Atualizar conversa').click();cy.contains('button','Ver anúncio').last().click();cy.get('[aria-label="Preparo e aprovação"]').find('button[aria-label="Atualizar preparo"]').click();cy.get('.mga-launch').contains('button','Aprovar e publicar').should('be.enabled');};
const complete=()=>{ask('Quero vender mais camisas na loja, priorizar vendas pagas no Brasil e aprovar manualmente.');ask('R$ 100 no total, de 16/11/2026 às 12h UTC até 23/11/2026 às 12h UTC.');refreshReview();};
describe('Campanha criada pela conversa',()=>{
  beforeEach(()=>{cy.intercept('GET','https://media.example.test/**',{statusCode:200,headers:{'content-type':'image/png'},fixture:'agentic-creative.png,null'});reset();enter();});
  afterEach(()=>{control('facts').then(({body})=>cy.writeFile('../../.specs/features/agentic-dashboard-assistant/t43-last-facts.json',body));});
  scenario('ADAS-56','free intent resolves canonical catalog but an ambiguous number does not become a budget',()=>{
    ask('Quero vender mais camisas na loja, priorizar vendas pagas no Brasil e aprovar manualmente.');cy.get('.chat-dock-reply').last().should('contain.text','orçamento');
    ask('100');cy.get('.chat-dock-reply').last().should('contain.text','Esse valor é por dia ou para todo o período?');
    cy.request(api()+'/v1/merchant-assistant/contexts/meta-ads/thread').then(({body})=>{expect(body.campaign.draft.variantIds).deep.eq(['variant-a']);expect(body.campaign.draft.priority).eq('paid_sales');expect(body.campaign.draft.budget??null).eq(null);expect(body.campaign.awaitingFields).deep.eq(['budget']);});
    control('facts').then(({body})=>{expect(body.states[0].campaigns).deep.eq([]);expect(body.writes).deep.eq([]);expect(body.images).eq(0);});
  });
  scenario('ADAS-56','correction and funding interruption preserve one canonical campaign and reload does not recreate or consume again',()=>{
    complete();cy.get('.mga-chat-campaign').last().should('contain.text','Camisa').and('contain.text','99,00').and('contain.text','Estoque: 8').and('contain.text','100,00');
    cy.get('.mga-launch').contains('button','Aprovar e publicar').should('be.enabled');
    ask('Corrija o orçamento para R$ 80 no total, mantendo as mesmas datas.');refreshReview();cy.get('.mga-chat-campaign').last().should('contain.text','80,00');
    ask('Como adiciono fundos para os anúncios?');cy.get('.chat-dock-reply').last().should('contain.text','Meta');
    let id='',calls=0,cost=0;control('facts').then(({body})=>{expect(body.states[0].campaigns).have.length(1);const campaign=body.states[0].campaigns[0];id=campaign.id;expect(campaign.draft.budget).deep.eq({amountCents:8000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-16T12:00:00.000Z',endsAt:'2026-11-23T12:00:00.000Z'});expect(campaign.products[0]).include({variantId:'variant-a',name:'Camisa',priceCents:9900,stockQuantity:8});calls=body.modelCalls;cost=body.confirmedAiCostMicros;expect(body.writes).deep.eq([]);});
    cy.reload();cy.get('.mga-chat-campaign').last().should('contain.text','80,00').and('contain.text','Camisa');cy.get('.chat-dock-history').should('contain.text','Como adiciono fundos');
    control('facts').then(({body})=>{expect(body.states[0].campaigns).have.length(1);expect(body.states[0].campaigns[0].id).eq(id);expect(body.modelCalls).eq(calls);expect(body.confirmedAiCostMicros).eq(cost);expect(body.images).eq(1);});
  });
  scenario('ADAS-56','native image review spends one credit and one exact approval launches the reviewed campaign',()=>{
    complete();control('facts').then(({body})=>{expect(body.images).eq(1);expect(body.reviewCalls).eq(1);expect(body.states[0].credits.monthlyAvailable).eq(29);expect(body.states[0].campaigns[0].draft.mediaIds).have.length(1);expect(body.writes).deep.eq([]);});
    cy.get('.mga-launch').find('img').should('have.length',1);cy.get('.mga-launch').contains('button','Aprovar e publicar').click();control('workers',{});cy.get('.mga-launch').should('contain.text','veiculação ainda não confirmada');
    control('facts').then(({body})=>{expect(body.states[0].campaigns).have.length(1);expect(body.states[0].campaigns[0].status).eq('active_unconfirmed');expect(body.writes.map((item:{tool:string})=>item.tool)).deep.eq(['ads_create_campaign','ads_create_ad_set','ads_create_creative','ads_create_ad','ads_activate_entity','ads_activate_entity','ads_activate_entity']);expect(body.states[0].executions).have.length(1);expect(body.states[0].proposals[0].approvedBy).eq('owner-a');expect(body.states[0].credits.monthlyAvailable).eq(29);expect(body.images).eq(1);});
  });
});
