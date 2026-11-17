import {ask,control,enter,reset,scenario} from '../../support/agentic.js';

const panel='[aria-label="Verba dos anúncios"]';
describe('Pagamentos e ajuda fundamentada',()=>{
  beforeEach(()=>{reset();});
  scenario('ADAS-55','prepaid separates media subscription debt and credits and opens the current official account route',()=>{
    enter();cy.contains('[role="tab"]','Configurações').click();cy.contains('Sua assinatura da Zyon não inclui o investimento dos anúncios. Esse valor é pago diretamente à Meta.').should('be.visible');
    cy.get(panel).contains('summary','Detalhes dos pagamentos').click();cy.get(panel).contains('summary','Ajuda sobre pagamentos').click();
    cy.get(panel).should('contain.text','Pré-paga: adicione fundos na Meta');
    cy.get(panel).contains('dt','Saldo pré-pago disponível').next('dd').should('have.text','Indisponível');
    cy.get(panel).contains('dt','Valor devido à Meta').next('dd').should('contain.text','50,00');
    let clicked='';cy.get(panel).contains('a','Abrir pagamentos na Meta').should('have.attr','href','https://business.facebook.com/latest/billing_hub/payment_settings/?payment_account_id=100&asset_id=100&nav_ref=billing_hub&placement=campaign_manager').then(link=>{
      link[0].addEventListener('click',event=>{event.preventDefault();clicked=(event.currentTarget as HTMLAnchorElement).href;},{once:true});
    }).click();cy.then(()=>{const destination=new URL(clicked);expect(destination.protocol).eq('https:');expect(destination.hostname).eq('business.facebook.com');expect(destination.searchParams.get('asset_id')).eq('100');expect(destination.searchParams.has('access_token')).eq(false);});
    cy.get(panel).contains('button','Verificar novamente').click();cy.get(panel).contains('dt','Saldo pré-pago disponível').next('dd').should('have.text','Indisponível');
    control('facts').then(({body})=>{expect(body.writes).deep.eq([]);expect(body.images).eq(0);expect(body.states[0].credits).deep.eq({monthlyAvailable:30,extraAvailable:0});});
  });
  scenario('ADAS-55','refresh reads postpaid and unknown facts without inventing a top-up or a payment confirmation',()=>{
    control('funding',{mode:'postpaid'});enter();cy.contains('[role="tab"]','Configurações').click();cy.get(panel).should('contain.text','Pós-paga: confira seu método de pagamento');cy.get(panel).should('contain.text','não exige recarga pré-paga').and('not.contain.text','Saldo pré-pago disponível');
    control('funding',{mode:'unknown'});cy.get(panel).contains('button','Verificar novamente').click();cy.get(panel).should('contain.text','Não foi possível verificar os pagamentos desta conta').and('not.contain.text','Pós-paga:');
    cy.get(panel).contains('dt','Valor devido à Meta').next('dd').should('have.text','Indisponível');
    cy.get(panel).should('contain.text','nenhum saldo será presumido');control('facts').then(({body})=>{expect(body.writes).deep.eq([]);expect(body.states[0].credits.monthlyAvailable).eq(30);});
  });
  scenario('ADAS-55','blocked funding keeps grounded help and a valid reviewed source available and changes billing route with store',()=>{
    control('funding',{mode:'prepaid',blocked:true});enter();cy.contains('[role="tab"]','Configurações').click();cy.get(panel).should('contain.text','Publicação bloqueada.');
    ask('Como adiciono fundos e resolvo os pagamentos dos anúncios?');cy.get('.chat-dock-reply').last().should('contain.text','paga diretamente à Meta');
    cy.get('.mga-chat-references').should('contain.text','Revisada em').and('contain.text','Versão');cy.get('.mga-chat-references > summary').first().click();cy.get('.mga-chat-references button').first().click();
    cy.get('[aria-label="Fonte da resposta"]').should('be.visible').and('contain.text','Versão atual').and('contain.text','Revisada em');cy.get('[aria-label="Fonte da resposta"] a').each(link=>{expect(new URL(link.attr('href')!).protocol).eq('https:');});
    control('facts').then(({body})=>{expect(body.retrievedReferenceIds.length).greaterThan(0);expect(body.writes).deep.eq([]);expect(body.confirmedAiCostMicros).greaterThan(0);});
    cy.get('[aria-label="Loja ativa"]').select('store-b');cy.get(panel).should('contain.text','Conta 101');cy.get(panel).contains('a','Abrir pagamentos na Meta').should('have.attr','href').then(href=>{const url=new URL(String(href));expect(url.searchParams.get('asset_id')).eq('101');expect(url.searchParams.get('payment_account_id')).eq('101');});
  });
});
