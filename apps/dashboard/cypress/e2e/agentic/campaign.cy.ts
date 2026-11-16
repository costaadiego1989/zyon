import {api,ask,control,enter,reset,scenario} from '../../support/agentic.js';
const complete=()=>{ask('Quero vender mais camisas na loja, priorizar vendas pagas no Brasil e aprovar manualmente.');ask('R$ 100 no total, de 16/11/2026 às 12h UTC até 23/11/2026 às 12h UTC.');};
describe('Campanha criada pela conversa',()=>{
  beforeEach(()=>{cy.intercept('GET','https://media.example.test/**',{statusCode:200,headers:{'content-type':'image/png'},body:Cypress.Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});reset();enter();});
  afterEach(()=>{control('facts').then(({body})=>cy.writeFile('../../.specs/features/agentic-dashboard-assistant/t43-last-facts.json',body));});
  scenario('ADAS-56','free intent resolves canonical catalog but an ambiguous number does not become a budget',()=>{
    ask('Quero vender mais camisas na loja, priorizar vendas pagas no Brasil e aprovar manualmente.');cy.get('.chat-dock-reply').last().should('contain.text','orçamento');
    ask('100');cy.get('.chat-dock-reply').last().should('contain.text','diário ou total').and('contain.text','datas');
    cy.request(api()+'/v1/merchant-assistant/contexts/meta-ads/thread').then(({body})=>{expect(body.campaign.draft.variantIds).deep.eq(['variant-a']);expect(body.campaign.draft.priority).eq('paid_sales');expect(body.campaign.draft.budget??null).eq(null);expect(body.campaign.awaitingFields).deep.eq(['budget']);});
    control('facts').then(({body})=>{expect(body.states[0].campaigns).deep.eq([]);expect(body.writes).deep.eq([]);expect(body.images).eq(0);});
  });
  scenario('ADAS-56','correction and funding interruption preserve one canonical campaign and reload does not recreate or consume again',()=>{
    complete();cy.get('.mga-chat-campaign').last().should('contain.text','Camisa').and('contain.text','99,00').and('contain.text','Estoque: 8').and('contain.text','100,00');
    cy.get('.mga-chat-campaign').last().contains('button','Gerar criativos').should('be.enabled');
    ask('Corrija o orçamento para R$ 80 no total, mantendo as mesmas datas.');cy.get('.mga-chat-campaign').last().should('contain.text','80,00');
    ask('Como adiciono fundos para os anúncios?');cy.get('.chat-dock-reply').last().should('contain.text','Meta');
    let id='',calls=0,cost=0;control('facts').then(({body})=>{expect(body.states[0].campaigns).have.length(1);const campaign=body.states[0].campaigns[0];id=campaign.id;expect(campaign.draft.budget).deep.eq({amountCents:8000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-16T12:00:00.000Z',endsAt:'2026-11-23T12:00:00.000Z'});expect(campaign.products[0]).include({variantId:'variant-a',name:'Camisa',priceCents:9900,stockQuantity:8});calls=body.modelCalls;cost=body.confirmedAiCostMicros;expect(body.writes).deep.eq([]);});
    cy.reload();cy.get('.mga-chat-campaign').last().should('contain.text','80,00').and('contain.text','Camisa');cy.get('.chat-dock-history').should('contain.text','Como adiciono fundos');
    control('facts').then(({body})=>{expect(body.states[0].campaigns).have.length(1);expect(body.states[0].campaigns[0].id).eq(id);expect(body.modelCalls).eq(calls);expect(body.confirmedAiCostMicros).eq(cost);expect(body.images).eq(0);});
  });
  scenario('ADAS-56','native image review spends one credit and manual reviewed preparation creates only paused objects',()=>{
    complete();cy.get('.mga-chat-campaign').last().contains('button','Gerar criativos').click();
    cy.get('.mga-chat-campaign').last().should('contain.text','Criativos gerados');control('facts').then(({body})=>{expect(body.images).eq(1);expect(body.reviewCalls).eq(1);expect(body.states[0].credits.monthlyAvailable).eq(29);expect(body.writes).deep.eq([]);});
    ask('Selecione o criativo gerado para esta campanha.');cy.get('.mga-chat-campaign').last().should('contain.text','Selecionado para esta campanha');
    cy.get('.mga-chat-campaign').last().contains('button','Solicitar preparo pausado').click();cy.get('.chat-dock .mga-proposal').last().within(()=>{cy.contains('button','Aprovar alteração').should('be.disabled');cy.get('input[type=checkbox]').check();cy.contains('button','Aprovar alteração').click();cy.contains('button','Executar alteração aprovada').click();cy.contains('Preparada, sem veiculação').should('be.visible');});
    control('facts').then(({body})=>{expect(body.states[0].campaigns).have.length(1);expect(body.states[0].campaigns[0].status).eq('remote_paused');expect(body.writes.map((item:{tool:string})=>item.tool)).deep.eq(['ads_create_campaign','ads_create_ad_set','ads_create_creative','ads_create_ad']);expect(body.states[0].credits.monthlyAvailable).eq(29);expect(body.images).eq(1);});
  });
});
