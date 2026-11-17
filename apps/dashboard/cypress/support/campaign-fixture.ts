import {api,control,eventuallyFacts} from './agentic.js';
export const command=(path:string,body:Cypress.RequestBody={})=>cy.request({url:api()+'/v1/meta-ads-agent'+path,method:'POST',headers:{origin:'http://127.0.0.1:5179'},body});
/** Prerequisite data through real signed canonical APIs. Campaign gestures are proved separately. */
export function preparedCampaign(){
  const draft={name:'Camisa para relatório',variantIds:['variant-a'],destination:'store',priority:'paid_sales',country:'BR',budget:{amountCents:10000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-16T12:00:00.000Z',endsAt:'2026-11-23T12:00:00.000Z'},headline:'Camisas para o seu dia',primaryText:'Conheça as camisas da loja.',mediaIds:[] as string[]};
  return command('/campaigns',{draft,idempotencyKey:crypto.randomUUID()}).then(({body:campaign})=>{
    return cy.request(api()+`/v1/meta-ads-agent/campaigns/${campaign.id}/preparation`).then(({body})=>command(`/campaigns/${campaign.id}/preparation`,{campaignDigest:body.campaignDigest,imageCount:1})).then(()=>control('workers',{})).then(()=>eventuallyFacts(body=>body.states[0].preparations.some((job:{campaignId:string;status:string})=>job.campaignId===campaign.id&&job.status==='review_ready'))).then(facts=>{
      const job=facts.states[0].preparations.find((p:{campaignId:string})=>p.campaignId===campaign.id),proposal=facts.states[0].proposals.find((p:{id:string})=>p.id===job.proposalId);
      expect(proposal.approvedBy).eq(null);return command(`/campaigns/${campaign.id}/proposals/${proposal.id}/approve-launch`,{digest:proposal.digest,idempotencyKey:crypto.randomUUID()});
    }).then(()=>control('workers',{})).then(()=>eventuallyFacts(body=>body.states[0].campaigns.some((c:{id:string;status:string})=>c.id===campaign.id&&c.status==='active_unconfirmed'))).then(facts=>{const state=facts.states[0],proposal=state.proposals.find((p:{campaignId:string;kind:string})=>p.campaignId===campaign.id&&p.kind==='launch');expect(proposal.status).eq('executed');expect(proposal.approvedBy).eq('owner-a');expect(state.executions.find((e:{proposalId:string})=>e.proposalId===proposal.id).error).eq(null);return cy.wrap<{id:string}>(campaign,{log:false});});
  });
}
export function externalImages(){cy.intercept('GET','https://media.example.test/**',{statusCode:200,headers:{'content-type':'image/png'},fixture:'agentic-creative.png,null'});}
export function openReport(){cy.contains('button','Atualizar conversa').click();cy.contains('[role="tab"]','Métricas').click();cy.contains('summary','Relatórios diários').then(summary=>{if(!(summary[0].parentElement as HTMLDetailsElement).open)cy.wrap(summary).click();});cy.get('[aria-label="Dia do relatório"]').select('16/11/2026 · America/Sao_Paulo');}
export function clock(now:string){return control('clock',{now});}
