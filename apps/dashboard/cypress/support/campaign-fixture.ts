import {api,control,eventuallyFacts} from './agentic.js';
export const command=(path:string,body:Cypress.RequestBody={})=>cy.request({url:api()+'/v1/meta-ads-agent'+path,method:'POST',headers:{origin:'http://127.0.0.1:5179'},body});
/** Prerequisite data through real signed canonical APIs. Campaign gestures are proved separately. */
export function preparedCampaign(){
  const draft={name:'Camisa para relatório',variantIds:['variant-a'],destination:'store',priority:'paid_sales',country:'BR',budget:{amountCents:10000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-16T12:00:00.000Z',endsAt:'2026-11-23T12:00:00.000Z'},headline:'Camisas para o seu dia',primaryText:'Conheça as camisas da loja.',mediaIds:[] as string[]};
  return command('/campaigns',{draft,idempotencyKey:crypto.randomUUID()}).then(({body:campaign})=>{
    return command(`/campaigns/${campaign.id}/generations`,{imageCount:1,idempotencyKey:crypto.randomUUID()}).then(()=>eventuallyFacts(body=>body.states[0].generations.some((job:{status:string})=>job.status==='succeeded'))).then(facts=>{
      draft.mediaIds=facts.states[0].generations[0].mediaIds;return cy.request({url:api()+`/v1/meta-ads-agent/campaigns/${campaign.id}`,method:'PUT',headers:{origin:'http://127.0.0.1:5179'},body:draft});
    }).then(()=>command(`/campaigns/${campaign.id}/proposals`,{kind:'prepare',after:{},reasoning:'Preparação pausada para o cenário de relatório',idempotencyKey:crypto.randomUUID()})).then(({body:proposal})=>command(`/proposals/${proposal.id}/approve`,{digest:proposal.digest}).then(({body:approved})=>{expect(approved.status).eq('approved');expect(approved.approvedBy).eq('owner-a');return command(`/proposals/${proposal.id}/execute`);})).then(({body:execution})=>{expect(execution.status).eq('remote_paused');expect(execution.error).eq(null);return cy.wrap(campaign,{log:false});});
  });
}
export function externalImages(){cy.intercept('GET','https://media.example.test/**',{statusCode:200,headers:{'content-type':'image/png'},body:Cypress.Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});}
export function openReport(){cy.contains('button','Atualizar conversa').click();cy.contains('summary','Relatórios diários').then(summary=>{if(!(summary[0].parentElement as HTMLDetailsElement).open)cy.wrap(summary).click();});cy.get('[aria-label="Dia do relatório"]').select('16/11/2026 · America/Sao_Paulo');}
export function clock(now:string){return control('clock',{now});}
