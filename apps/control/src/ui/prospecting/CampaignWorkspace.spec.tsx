import {expect,test,vi} from "vitest";
import {act} from "react";
import {PlatformApiError} from "../../lib/api.js";
import {ProspectCommandUnresolved} from "../../lib/prospecting-api.js";
import {CampaignWorkspace} from "./CampaignWorkspace.js";
import {screenProps,show} from "./screen-test.js";
const draft={id:"draft",name:"Lojas SP",setupVersion:2,revision:1,state:"draft",businessContext:"lojas de roupas em SP",offerPolicy:{mode:"catalog"},message:null,offer:null,senderBindingId:null,senderVersion:null,template:null,limits:null,sendWindow:null,directorySnapshotId:null,audienceCriteria:null,planningMode:null,manualCompanyCount:0,recipientCount:0,selectionId:null,blockers:[],audienceHash:null,contentHash:"hash"};
const source={status:"current",value:{snapshotId:"published-source",state:"published"}};
const readiness={source,knowledge:{status:"current",value:{activePublications:0}},channel:{status:"unavailable",value:null}};
const common={draft:async()=>draft,campaignCompanies:async()=>({items:[],nextCursor:null,count:0,manualCount:0,snapshotId:null}),sender:async()=>({binding:null,status:"unknown",templates:[],blockers:["sender_unavailable"]}),config:async()=>({workersRunning:false,dispatchMode:"disabled",modelMode:"disabled"}),readiness:async()=>readiness};
test("CAMP-07 message selection persists its exact body and draft status cannot enable reviewed execution",async()=>{
 const template={id:"local-template",name:"zyon_intro",body:"Olá, podemos conversar sobre sua loja?",language:"pt_BR",state:"draft"};
 const configured={...draft,directorySnapshotId:"published-source",senderBindingId:"sender",senderVersion:1,limits:{dailyRecipients:1,budget:{amountCents:500,currency:"BRL"}},sendWindow:{timezone:"America/Sao_Paulo",weekdays:[1],start:"09:00",end:"18:00"}};
 const editDraft=vi.fn(async(_id,body)=>({...configured,revision:2,message:body.message}));
 const ui=await show(<CampaignWorkspace {...screenProps({...common,draft:async()=>configured,templates:async()=>[template],editDraft,sender:async()=>({binding:{id:"sender",version:1,wabaId:"waba"},status:"ready",templates:[],blockers:[]}),config:async()=>({workersRunning:true,dispatchMode:"controlled",modelMode:"controlled"}),readiness:async()=>({...readiness,knowledge:{status:"current",value:{activePublications:1}}})})} id={draft.id}/>);
 await ui.click("Usar zyon_intro nesta campanha");expect(editDraft.mock.calls[0]).toEqual([draft.id,{expectedRevision:1,message:template.body,template:null,clientRequestId:expect.any(String)}]);
 expect(ui.text()).toContain(template.body);expect(ui.text()).toContain("Texto selecionado nesta campanha");expect(ui.text()).toContain("Não enviado à Meta");expect(ui.button("Preparar revisão da campanha").disabled).toBe(true);
});
test("CAMP-07 creates from name/context without loading sender offers segments or templates and immediately researches its published source",async()=>{
 const createDraft=vi.fn<(body:{clientRequestId:string})=>Promise<typeof draft>>().mockResolvedValue(draft),sender=vi.fn(async()=>{throw new PlatformApiError(503);}),offers=vi.fn(),segments=vi.fn();
 const prepared={...draft,revision:2,directorySnapshotId:"published-source",audienceCriteria:{ufs:["SP"],mainCnaes:["4781400"]},planningMode:"rules"};
 const prepareContext=vi.fn(async()=>({id:"job",campaignId:draft.id,state:"completed",mode:"rules",errorCode:null}));
 const props=screenProps({...common,sender,offers,segments,createDraft,prepareContext,draft:async()=>prepared});
 const ui=await show(<CampaignWorkspace {...props}/>);
 expect(sender).not.toHaveBeenCalled();expect(offers).not.toHaveBeenCalled();expect(segments).not.toHaveBeenCalled();expect(ui.host.querySelector("select")).toBeNull();
 await ui.fill("Nome da campanha","Lojas SP");await ui.fill("Contexto das empresas","lojas de roupas em SP");await ui.click("Criar campanha");
 expect(createDraft.mock.calls[0][0]).toEqual({name:"Lojas SP",businessContext:"lojas de roupas em SP",clientRequestId:expect.any(String)});
 expect(prepareContext.mock.calls[0]).toEqual([draft.id,{expectedRevision:1,snapshotId:"published-source",clientRequestId:(createDraft.mock.calls[0][0] as {clientRequestId:string}).clientRequestId+":context"}]);
 expect(props.navigate).toHaveBeenCalledWith({area:"campaigns",id:draft.id,filters:{view:"edit"}});
 expect(ui.text()).toContain("Campanha salva. Empresas preparadas");expect(ui.text()).toContain("catálogo vigente");expect(ui.text()).toContain("sem chamada de IA");
 expect(ui.text()).toContain("Não foi possível conferir o número da Zyon");expect(ui.text()).not.toContain("Conecte o número próprio da Zyon para enviar");expect(ui.button("Preparar revisão da campanha").disabled).toBe(true);expect(ui.text()).not.toContain("Iniciar campanha");expect(createDraft).toHaveBeenCalledTimes(1);
});
test("CAMP-07 confirms creation and saved identity before a failed contextual preparation and never offers duplicate creation",async()=>{
 let finish!:(value:unknown)=>void;
 const createDraft=vi.fn(async()=>draft),prepareContext=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const props=screenProps({...common,createDraft,prepareContext});const ui=await show(<CampaignWorkspace {...props}/>);
 await ui.fill("Nome da campanha","Lojas SP");await ui.fill("Contexto das empresas","lojas de roupas em SP");
 await act(async()=>ui.button("Criar campanha").click());
 expect(ui.text()).toContain("Campanha criada e salva");expect(props.navigate).toHaveBeenCalledWith({area:"campaigns",id:draft.id,filters:{view:"edit"}});expect(ui.text()).not.toContain("Comece pelo nome");
 await act(async()=>finish(Promise.reject(new PlatformApiError(503))));
 expect(ui.text()).toContain("Campanha criada e salva. A pesquisa de empresas está pendente");expect(ui.control("Nome da campanha").value).toBe(draft.name);expect(ui.text()).not.toContain("falha ao criar");expect(createDraft).toHaveBeenCalledTimes(1);
});
test("CAMP-07 name-only creation preserves absent configuration and context ambiguity is actionable",async()=>{
 const createDraft=vi.fn<(body:{clientRequestId:string})=>Promise<unknown>>().mockResolvedValue({...draft,businessContext:null});const props=screenProps({...common,createDraft});const ui=await show(<CampaignWorkspace {...props}/>);
 await ui.fill("Nome da campanha","Pesquisa");await ui.click("Criar campanha");expect(createDraft.mock.calls[0][0]).toEqual({name:"Pesquisa",clientRequestId:expect.any(String)});expect(ui.text()).toContain("Adicione empresas pela busca");
 const blocked=await show(<CampaignWorkspace {...screenProps({...common,prepareContext:async()=>({id:"blocked",campaignId:draft.id,state:"blocked",errorCode:"model_disabled"})})} id={draft.id}/>);
 await blocked.click("Preparar empresas pelo contexto");expect(blocked.text()).toContain("A interpretação por IA precisa ser habilitada");expect(blocked.text()).not.toContain("Em execução");
});
test("CAMP-07 saves context while sender is unavailable and exact server revision governs the next operation",async()=>{
 const editDraft=vi.fn(async(_id,body)=>({...draft,businessContext:body.businessContext,revision:2}));
 const props=screenProps({...common,sender:async()=>{throw new PlatformApiError(503);},editDraft});const ui=await show(<CampaignWorkspace {...props} id={draft.id}/>);
 await ui.fill("Contexto das empresas","lojas de roupas em RJ");expect(ui.button("Preparar empresas pelo contexto").disabled).toBe(true);await ui.click("Salvar contexto");
 expect(editDraft.mock.calls[0][1]).toMatchObject({expectedRevision:1,businessContext:"lojas de roupas em RJ"});expect(ui.text()).toContain("Contexto salvo");expect(ui.button("Preparar empresas pelo contexto").disabled).toBe(false);
});
test("CAMP-07 unknown creation outcome is recovered with the original command and does not create again",async()=>{
 let key="";const createDraft=vi.fn(async body=>{key=body.clientRequestId;throw new ProspectCommandUnresolved(key,"pending");});
 const command=vi.fn(async clientRequestId=>({clientRequestId,state:"completed",result:draft}));const props=screenProps({...common,createDraft,command});const ui=await show(<CampaignWorkspace {...props}/>);
 await ui.fill("Nome da campanha","Pesquisa");await ui.click("Criar campanha");expect(ui.button("Criar campanha").disabled).toBe(true);await ui.click("Consultar resultado do comando");
 expect(command).toHaveBeenCalledWith(key);expect(createDraft).toHaveBeenCalledTimes(1);expect(props.navigate).toHaveBeenCalledWith({area:"campaigns"});
});
test("CAMP-07 saving limits observes the own sender even when its initial read is still pending",async()=>{
 const binding={id:"own",version:4,displayPhoneNumber:"local"};
 const sender=vi.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValue({binding,status:"ready",templates:[],blockers:[]});
 const editDraft=vi.fn(async(_id,body)=>({...draft,revision:2,senderBindingId:body.senderBindingId,senderVersion:body.senderVersion,limits:body.limits,sendWindow:body.sendWindow}));
 const ui=await show(<CampaignWorkspace {...screenProps({...common,sender,editDraft})} id={draft.id}/>);
 expect(ui.text()).toContain("Consultando o número da Zyon");expect(ui.text()).not.toContain("Conecte o número próprio da Zyon para enviar");
 await ui.fill("Destinatários por dia","2");await ui.fill("Orçamento total (R$)","10,00");await ui.click("Salvar configuração de envio");
 expect(editDraft.mock.calls[0][1]).toMatchObject({expectedRevision:1,senderBindingId:"own",senderVersion:4,limits:{dailyRecipients:2,budget:{amountCents:1000,currency:"BRL"}}});expect(ui.text()).toContain("Limites e janela salvos");
});
test("CAMP-07 refreshing messages recovers the shared sender after an unavailable observation without remounting",async()=>{
 const template={id:"local",name:"intro",body:"Texto da campanha",state:"draft",language:"pt_BR"};
 const sender=vi.fn().mockRejectedValueOnce(new PlatformApiError(503)).mockResolvedValue({binding:{id:"own",version:1},status:"ready",templates:[],blockers:[]});
 const ui=await show(<CampaignWorkspace {...screenProps({...common,sender,templates:async()=>[template]})} id={draft.id}/>);
 expect(ui.button("Enviar intro à Meta").disabled).toBe(true);await ui.click("Atualizar mensagens");expect(ui.button("Enviar intro à Meta").disabled).toBe(false);expect(sender).toHaveBeenCalledTimes(2);
});
test("CAMP-07 Meta synchronization refreshes shared template health before reviewed preparation becomes available",async()=>{
 const template={id:"local",name:"intro",body:"Texto da campanha",state:"PENDING",language:"pt_BR",revision:1};let approved=false;
 const binding={id:"own",version:1,wabaId:"waba",displayPhoneNumber:"local"};
 const configured={...draft,message:template.body,directorySnapshotId:"published-source",senderBindingId:"own",senderVersion:1,limits:{dailyRecipients:1,budget:{amountCents:500,currency:"BRL"}},sendWindow:{timezone:"America/Sao_Paulo",weekdays:[1],start:"09:00",end:"18:00"}};
 const sender=vi.fn(async()=>({binding,status:"ready",templates:approved?[{id:"meta",wabaId:"waba",previewText:template.body,status:"APPROVED",category:"MARKETING",requiresParameters:false}]:[],blockers:[]}));
 const props=screenProps({...common,draft:async()=>configured,sender,templates:async()=>[{...template,state:approved?"APPROVED":"PENDING"}],syncTemplate:async()=>{approved=true;return {...template,state:"APPROVED"};},config:async()=>({workersRunning:true,dispatchMode:"controlled",modelMode:"controlled"}),readiness:async()=>({...readiness,channel:{status:"current",value:{status:"ready"}},knowledge:{status:"current",value:{activePublications:1}}})});
 const ui=await show(<CampaignWorkspace {...props} id={draft.id}/>);expect(ui.button("Preparar revisão da campanha").disabled).toBe(true);await ui.click("Atualizar estado de intro na Meta");expect(ui.button("Preparar revisão da campanha").disabled).toBe(false);expect(sender).toHaveBeenCalledTimes(2);
});
