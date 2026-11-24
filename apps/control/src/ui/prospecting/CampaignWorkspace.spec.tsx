import {expect,test,vi} from "vitest";
import {act,useState} from "react";
import {PlatformApiError} from "../../lib/api.js";
import {ProspectCommandUnresolved} from "../../lib/prospecting-api.js";
import {CampaignWorkspace} from "./CampaignWorkspace.js";
import {CampaignDetailPage} from "./CampaignDetailPage.js";
import {screenProps,show} from "./screen-test.js";
const draft={id:"draft",name:"Lojas SP",setupVersion:2,revision:1,state:"draft",businessContext:"lojas de roupas em SP",offerPolicy:{mode:"catalog"},message:null,offer:null,senderBindingId:null,senderVersion:null,template:null,limits:null,sendWindow:null,directorySnapshotId:null,audienceCriteria:null,planningMode:null,manualCompanyCount:0,recipientCount:0,selectionId:null,blockers:[],audienceHash:null,contentHash:"hash"};
const source={status:"current",value:{snapshotId:"published-source",state:"published"}};
const readiness={source,knowledge:{status:"current",value:{activePublications:0}},channel:{status:"unavailable",value:null}};
const common={draft:async()=>draft,campaignCompanies:async()=>({items:[],nextCursor:null,count:0,manualCount:0,snapshotId:null}),sender:async()=>({binding:null,status:"unknown",templates:[],blockers:["sender_unavailable"]}),config:async()=>({workersRunning:false,dispatchMode:"disabled",modelMode:"disabled"}),readiness:async()=>readiness};

test("MAX-PRICE AC5 selects the priced registry entry even when its body matches the standard message",async()=>{
 const message="Texto já selecionado";
 const selected={...draft,message};const priced={id:"priced",name:"price_variant",body:message,state:"PENDING",maxPrice:{currency:"BRL",amountPerThousandMinor:10000},language:"pt_BR"};
 const editDraft=vi.fn(async(_id,body)=>({...selected,revision:2,templateRegistryId:body.templateRegistryId}));
 const ui=await show(<CampaignWorkspace {...screenProps({...common,draft:async()=>selected,templates:async()=>[priced],editDraft})} id={draft.id}/>);
 expect(ui.button("Usar price_variant nesta campanha").disabled).toBe(false);await ui.click("Usar price_variant nesta campanha");
 expect(editDraft.mock.calls[0][1]).toEqual({expectedRevision:1,message,template:null,templateRegistryId:"priced",clientRequestId:expect.any(String)});
 expect(ui.text()).toContain("Max Price: até R$ 0,10 por entrega");expect(ui.text()).toContain("Em análise pela Meta");expect(ui.button("Preparar revisão da campanha").disabled).toBe(true);
 expect(ui.control("Orçamento total (R$)").value).toBe("");
});

test("UI AC1 switches campaign work areas with keyboard support and preserves unsaved values",async()=>{
 const editDraft=vi.fn(),createTemplate=vi.fn();
 const ui=await show(<CampaignWorkspace {...screenProps({...common,editDraft,createTemplate})} id={draft.id}/>);
 const tabs=Array.from(ui.host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
 const panels=Array.from(ui.host.querySelectorAll<HTMLDivElement>('[role="tabpanel"]'));
 expect(tabs.map(t=>t.textContent)).toEqual(["Empresas","Mensagem","Envio"]);expect(panels.map(p=>p.hidden)).toEqual([false,true,true]);
 await ui.click("Envio");await ui.fill("Orçamento total (R$)","120,00");await ui.fill("Destinatários por dia","100");
 await ui.click("Mensagem");await ui.click("Preparar mensagem");await ui.fill("Preço da mensagem","max_price");await ui.fill("Teto por entrega (R$)","0,12");
 await ui.click("Cancelar mensagem");await ui.click("Empresas");await ui.click("Mensagem");await ui.click("Preparar mensagem");expect(ui.control("Teto por entrega (R$)").value).toBe("0,12");await ui.click("Cancelar mensagem");
 await act(async()=>{tabs[1].focus();tabs[1].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));});
 expect(document.activeElement).toBe(tabs[2]);expect(tabs[2].getAttribute('aria-selected')).toBe('true');expect(panels.map(p=>p.hidden)).toEqual([true,true,false]);
 expect(ui.control("Orçamento total (R$)").value).toBe("120,00");expect(ui.control("Destinatários por dia").value).toBe("100");
 expect(editDraft).not.toHaveBeenCalled();expect(createTemplate).not.toHaveBeenCalled();
});

test("UI AC1 creates campaigns in a focused modal over the list and cancellation does not create a campaign",async()=>{
 const createDraft=vi.fn(),props=screenProps({...common,createDraft,campaigns:async()=>({items:[{...draft,name:'Campanha existente'}],nextCursor:null})});
 const ui=await show(<CampaignWorkspace {...props}/>);
 const modal=ui.host.querySelector('dialog')!;
 expect(modal.open).toBe(true);expect(modal.getAttribute('aria-labelledby')).toBeTruthy();
 expect(modal.contains(ui.control('Nome da campanha'))).toBe(true);expect(modal.contains(ui.control('Contexto das empresas'))).toBe(true);
 expect(ui.text()).toContain('Campanha existente');expect(document.documentElement.style.overflow).toBe('hidden');
 await ui.fill('Nome da campanha','Varejo SP');await ui.fill('Contexto das empresas','lojas de roupas em SP');await ui.click('Cancelar');
 expect(props.navigate).toHaveBeenCalledWith({area:'campaigns'});expect(createDraft).not.toHaveBeenCalled();
});

test("UI AC1 composes a message in its own modal with one editable body and restores the opener on cancellation",async()=>{
 const createTemplate=vi.fn();
 const ui=await show(<CampaignWorkspace {...screenProps({...common,createTemplate})} id={draft.id}/>);
 await ui.click('Mensagem');ui.button('Preparar mensagem').focus();await ui.click('Preparar mensagem');
 const modal=ui.host.querySelector('dialog')!;expect(modal.open).toBe(true);
 expect(modal.querySelectorAll('textarea')).toHaveLength(1);expect(modal.querySelector('.campaign-message-body')).toBeNull();
 await ui.fill('Preço da mensagem','max_price');expect(modal.contains(ui.control('Teto por entrega (R$)'))).toBe(true);expect(ui.control('Teto por entrega (R$)').value).toBe('');
 await ui.fill('Texto da mensagem','Texto ainda não salvo');await ui.click('Cancelar mensagem');
 expect(ui.host.querySelector('dialog')).toBeNull();expect(document.activeElement).toBe(ui.button('Preparar mensagem'));expect(createTemplate).not.toHaveBeenCalled();
 await ui.click('Preparar mensagem');expect(ui.control('Texto da mensagem').value).toBe('Texto ainda não salvo');
});

test("UI AC1 returns keyboard focus to the create launcher after cancelling across the campaign route",async()=>{
 const props=screenProps(common);
 function Flow(){const [creating,setCreating]=useState(false);return creating?<CampaignWorkspace {...props} navigate={()=>setCreating(false)}/>:<CampaignDetailPage {...props} navigate={()=>setCreating(true)}/>;}
 const ui=await show(<Flow/>);const oldLauncher=ui.button('Criar campanha');oldLauncher.focus();
 await ui.click('Criar campanha');expect(ui.host.querySelector('dialog')?.open).toBe(true);
 await ui.click('Cancelar');expect(ui.host.querySelector('dialog')).toBeNull();expect(oldLauncher.isConnected).toBe(false);
 expect(document.activeElement).toBe(ui.button('Criar campanha'));
});

test("UI AC1 shows one selected message preview and concise actions while preserving template identity",async()=>{
 const selected={...draft,message:"Uma mensagem selecionada",templateRegistryId:"chosen"};
 const template={id:"chosen",name:"zyon_varejo_pt_br_1234567890",body:selected.message,state:"PENDING",language:"pt_BR",revision:1};
 const ui=await show(<CampaignWorkspace {...screenProps({...common,draft:async()=>selected,templates:async()=>[template]})} id={draft.id}/>);
 await ui.click('Mensagem');
 expect(ui.host.querySelector('.prospecting-template-list')?.hasAttribute('hidden')).toBe(true);
 expect(ui.host.querySelectorAll('.campaign-selected-message .campaign-message-body')).toHaveLength(1);
 expect(ui.host.querySelector('.campaign-selected-message .campaign-message-body')?.textContent).toBe(selected.message);
 expect(ui.button('Atualizar estado de '+template.name+' na Meta').textContent).toBe('Atualizar estado');
 await ui.click('Trocar mensagem');expect(ui.host.querySelector('.prospecting-template-list')?.hasAttribute('hidden')).toBe(false);
 await ui.click('Concluir escolha');expect(ui.host.querySelector('.prospecting-template-list')?.hasAttribute('hidden')).toBe(true);
});
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
