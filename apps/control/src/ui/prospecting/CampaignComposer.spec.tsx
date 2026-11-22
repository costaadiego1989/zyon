import {expect,test,vi} from "vitest";
import {CampaignComposer} from "./CampaignComposer.js";
import {screenProps,show} from "./screen-test.js";
const offer={planKey:"growth",version:"v8",name:"Growth",price:{currency:"BRL",amountCents:19900},billingCycle:"monthly",features:[]};
const template={id:"tpl",name:"contato",language:"pt_BR",status:"APPROVED",category:"MARKETING",wabaId:"wa",revision:"v1",previewText:"Conheça os planos Zyon.",requiresParameters:false};
const binding={id:"sender",version:2,displayPhoneNumber:"+55 11 1111-0000",wabaId:"wa"};
const sendWindow={timezone:"America/Sao_Paulo",weekdays:[1,2,3,4,5],start:"09:00",end:"18:00"};
const campaign={id:"camp",name:"Oficinas",state:"review_ready",revision:5,message:template.previewText,template,offer,sendWindow,senderBindingId:"sender",senderVersion:2,limits:{dailyRecipients:7,budget:{amountCents:4211,currency:"BRL"}},audienceHash:"frozen",contentHash:"review",selectionId:"sel",recipientCount:12,blockers:[]};
const common={offers:async()=>({items:[offer]}),sender:async()=>({binding,status:"ready",templates:[template],blockers:[]}),segments:async()=>({items:[{id:"seg",name:"Oficinas",version:2,snapshotId:"snap"}],nextCursor:null})};
test("PROS-26 AC1 revisão exibe seleção congelada e aprovação usa a revisão apresentada",async()=>{
 const approve=vi.fn().mockResolvedValue({...campaign,state:"approved"});
 const props=screenProps({...common,campaign:async()=>campaign,approve,selection:async()=>({companyCount:17,recipientCount:12,missingEndpointCount:5,state:"complete"})});
 const ui=await show(<CampaignComposer {...props} id="camp"/>);expect(ui.text()).toContain("17 empresas");expect(ui.text()).toContain("12 destinatários");expect(ui.text()).toContain("5 sem contato");expect(ui.text()).toContain(template.previewText);expect(ui.text()).toContain("Growth");expect(ui.text()).toContain(binding.displayPhoneNumber);expect(ui.text()).toContain("48 horas");expect(ui.text()).toContain("42,11");
 await ui.click("Aprovar revisão");expect(approve.mock.calls[0][1]).toMatchObject({expectedRevision:5,audienceHash:"frozen",contentHash:"review"});expect(ui.text()).toContain("Aprovada");
});
test("PROS-26 AC2 limites explícitos e BODY estático impedem revisão incompleta ou incompatível",async()=>{
 const createCampaign=vi.fn().mockResolvedValue({...campaign,state:"draft",selectionId:null,audienceHash:null});
 const props=screenProps({...common,sender:async()=>({binding,status:"blocked",templates:[template,{...template,id:"dynamic",requiresParameters:true}],blockers:["quality_restricted"]}),createCampaign});
 const ui=await show(<CampaignComposer {...props}/>);await ui.fill("Nome da campanha","Oficinas");await ui.fill("Template aprovado","dynamic");expect(ui.text()).toContain("parâmetros ou mídia");expect(ui.button("Salvar rascunho").disabled).toBe(true);
 await ui.fill("Template aprovado","tpl");await ui.fill("Plano","growth");expect(ui.button("Salvar rascunho").disabled).toBe(true);await ui.fill("Destinatários por dia","7");await ui.fill("Orçamento (R$)","42,11");await ui.click("Salvar rascunho");expect(createCampaign.mock.calls[0][0]).toMatchObject({message:template.previewText,planKey:"growth",senderBindingId:"sender",senderVersion:2,limits:campaign.limits});expect(ui.text()).toContain("Qualidade do canal restrita");expect(ui.text()).not.toContain("Em execução");
});
