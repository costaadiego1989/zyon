import { platformSignup } from "./platform-signup.js";
import { expect, test, vi } from "vitest";
import {act} from "react";
import {PlatformApiError} from "../../lib/api.js";
import { ProspectingChannelPage } from "./ProspectingChannelPage.js";
import { exerciseReadFailure, screenProps, show } from "./screen-test.js";
const binding = {
  id: "b",
  version: 3,
  wabaId: "100005",
  displayPhoneNumber: "+55 11 99999-0101",
  phoneNumberId: "100004",
};
const sender = {
  binding,
  status: "ready",
  blockers: [],
  updatedAt: "2026-11-16T10:00:00Z",
  templates: [{ id: "t", name: "oferta", language: "pt_BR", status: "APPROVED", previewText: "Mensagem estática." }],
  portfolioLimit: 400,
  portfolioUsed: 2,
};
const state = {
  state: "opaque-once",
  appId: "100001",
  configId: "100002",
  signupVersion: "v5",
  extras: { version: "v5", features: [{ name: "whatsapp_business_app_onboarding", enabled: false }] },
  expiresAt: new Date(Date.now() + 300000).toISOString(),
};

const localTemplate={id:"registered",purpose:"zyon_sales",name:"zyon_sales",language:"pt_BR",body:"Olá! Podemos conversar sobre sua loja? Se não quiser receber mensagens, avise por aqui.",revision:1,state:"draft",providerId:null,providerRevision:null,bindingId:null,bindingVersion:null,wabaId:null,reason:null,observedAt:null};
test("CAMP-04 platform message permission denial blocks new drafts while channel remains readable",async()=>{
 const createTemplate=vi.fn();const ui=await show(<ProspectingChannelPage {...screenProps({sender:async()=>sender,templates:async()=>{throw new PlatformApiError(403);},createTemplate})} mode="disabled"/>);
 expect(ui.text()).toContain(binding.displayPhoneNumber);expect(ui.text()).toContain("permissão");expect(ui.button("Preparar mensagem").disabled).toBe(true);await ui.click("Preparar mensagem");expect(createTemplate).not.toHaveBeenCalled();
});
test("CAMP-04 status provider approval with a content mismatch never labels the local preview as the approved body",async()=>{
 const template={...localTemplate,state:"APPROVED",reason:"template_content_mismatch",providerRevision:null};
 const ui=await show(<ProspectingChannelPage {...screenProps({sender:async()=>sender,templates:async()=>[template]})} mode="controlled"/>);
 const primary=ui.host.querySelector('.prospecting-template header p')!;expect(primary.textContent).toContain("Conteúdo diferente do aprovado na Meta");expect(primary.textContent).not.toContain("Aprovado pela Meta");
 expect(ui.text()).toContain("Estado do template na Meta: Aprovado pela Meta");expect(ui.text()).toContain("O texto salvo abaixo não está aprovado para envio");expect(ui.text()).toContain(localTemplate.body);
});
test("CAMP-04 platform message draft and complete body remain visible without sender and never imply Meta approval",async()=>{
 let templates:unknown[]=[];
 const createTemplate=vi.fn(async body=>{const saved={...localTemplate,body:body.body,name:body.name};templates=[saved];return saved;});
 const submitTemplate=vi.fn();const ui=await show(<ProspectingChannelPage {...screenProps({sender:async()=>({...sender,binding:null,templates:[]}),templates:async()=>templates,createTemplate,submitTemplate})} mode="disabled"/>);
 await ui.click("Preparar mensagem");expect(document.activeElement).toBe(ui.control("Nome da mensagem"));await ui.fill("Nome da mensagem","zyon_sales");await ui.fill("Texto da mensagem",localTemplate.body);await ui.click("Salvar rascunho da mensagem");
 expect(createTemplate.mock.calls[0][0]).toMatchObject({name:"zyon_sales",language:"pt_BR",body:localTemplate.body});expect(ui.text()).toContain(localTemplate.body);expect(ui.text()).toContain("Rascunho · Não enviado à Meta");expect(ui.text()).not.toContain("Aprovado pela Meta");expect(ui.button("Enviar zyon_sales à Meta").disabled).toBe(true);expect(submitTemplate).not.toHaveBeenCalled();
 expect(document.activeElement).toBe(ui.button("Preparar mensagem"));await ui.click("Preparar mensagem");await act(async()=>ui.control("Texto da mensagem").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(document.activeElement).toBe(ui.button("Preparar mensagem"));
});
test("CAMP-04 status submit and sync show actual pending rejected and approved observations with provider reason",async()=>{
 let template={...localTemplate,reason:null as string|null};
 const submitTemplate=vi.fn<(id:string,body:{expectedRevision:number})=>Promise<unknown>>().mockImplementation(async()=>{template={...template,revision:2,state:"PENDING"};return template;});
 const syncTemplate=vi.fn().mockImplementationOnce(async()=>{template={...template,revision:3,state:"REJECTED",reason:"Mensagem rejeitada pelo provedor"};return template;}).mockImplementationOnce(async()=>{template={...template,revision:4,state:"APPROVED",reason:null};return template;});
 const ui=await show(<ProspectingChannelPage {...screenProps({sender:async()=>sender,templates:async()=>[template],submitTemplate,syncTemplate})} mode="controlled"/>);
 await ui.click("Enviar zyon_sales à Meta");expect(submitTemplate.mock.calls[0][1]).toMatchObject({expectedRevision:1});expect(ui.text()).toContain("Em análise pela Meta");expect(ui.text()).not.toContain("Aprovado pela Meta");
 await ui.click("Atualizar estado de zyon_sales na Meta");expect(syncTemplate.mock.calls[0][1]).toMatchObject({expectedRevision:2});expect(ui.text()).toContain("Rejeitado pela Meta");expect(ui.text()).toContain("Mensagem rejeitada pelo provedor");expect(ui.text()).toContain(localTemplate.body);
 await ui.click("Atualizar estado de zyon_sales na Meta");expect(ui.text()).toContain("Aprovado pela Meta");expect(submitTemplate).toHaveBeenCalledTimes(1);expect(ui.text()).toContain("Ambiente controlado");
});
test("CAMP-04 status uncertain submission offers reconciliation and cannot submit a duplicate",async()=>{
 const template={...localTemplate,state:"submission_unknown",bindingId:"binding",reason:"create_outcome_unknown"};const submitTemplate=vi.fn(),syncTemplate=vi.fn(async()=>({...template,state:"PENDING",revision:2}));
 const ui=await show(<ProspectingChannelPage {...screenProps({sender:async()=>sender,templates:async()=>[template],submitTemplate,syncTemplate})} mode="controlled"/>);
 expect(ui.text()).toContain("Resultado do envio à Meta desconhecido");expect(ui.text()).not.toContain("Enviar zyon_sales à Meta");await ui.click("Confirmar resultado de zyon_sales");expect(syncTemplate).toHaveBeenCalledTimes(1);expect(submitTemplate).not.toHaveBeenCalled();expect(ui.text()).toContain("Em análise pela Meta");
});
test("PROS-29 AC1 configuração mostra observação e templates do número próprio", async () => {
  const ui = await show(<ProspectingChannelPage {...screenProps({ sender: async () => sender })} mode="disabled" />);
  expect(ui.text()).toContain(binding.displayPhoneNumber);
  expect(ui.text()).toContain("100005");
  expect(ui.text()).toContain("16/11/2026");
  expect(ui.text()).toContain("Mensagem estática.");
  expect(ui.host.querySelector("input")).toBeNull();
});
test("PROS-29 AC3 canal impedido exibe os pré-requisitos sem recorrer a outra conta", async () => {
  const ui = await show(
    <ProspectingChannelPage
      {...screenProps({
        sender: async () => ({
          ...sender,
          binding: null,
          status: "blocked",
          blockers: ["permission_unavailable", "no_opt_in"],
        }),
      })}
      mode="disabled"
    />
  );
  expect(ui.text()).toContain("Permissão do canal indisponível");
  expect(ui.text()).toContain("Sem opt-in");
  expect(ui.text()).not.toContain("Athom");
  expect(ui.text()).toContain("Sem vínculo");
});
test("PROS-29 AC4 Embedded Signup v5 usa estado único, seleção explícita e binding confirmado", async () => {
  const connect = vi.fn().mockResolvedValue(binding);
  const sdk = {
    prepare: vi.fn(async () => {}),
    open: vi.fn(async () => ({
      code: "one-use-code",
      messagingAccountIds: ["100005", "100006"],
      businessId: "100003",
      phoneNumberId: "100004",
      isOnBizApp: false as const,
    })),
  };
  const props = screenProps({
    signupState: async () => state,
    connect,
    sender: vi
      .fn()
      .mockResolvedValueOnce({ ...sender, binding: null })
      .mockResolvedValue(sender),
  });
  const ui = await show(<ProspectingChannelPage {...props} mode="controlled" controlledSdk={sdk} />);
  await ui.click("Conectar número Zyon");
  await ui.click("Abrir autorização");
  expect(connect).not.toHaveBeenCalled();
  await ui.fill("Conta de mensagens autorizada", "100005");
  await ui.click("Confirmar vínculo");
  expect(sdk.open.mock.calls[0]).toEqual(
    expect.arrayContaining([expect.objectContaining({ signupVersion: "v5", extras: state.extras })])
  );
  expect(connect.mock.calls[0][0]).toMatchObject({
    state: state.state,
    code: "one-use-code",
    wabaId: "100005",
    businessId: "100003",
    messagingAccountIds: ["100005", "100006"],
    phoneNumberId: "100004",
    isOnBizApp: false,
  });
  expect(ui.text()).toContain(binding.displayPhoneNumber);
  expect(ui.text()).not.toContain("one-use-code");
  expect(ui.text()).toContain("Ambiente controlado");
});

test("PROS-29 AC4 SDK correlates callback with the exact Meta origin and v5 assets", async () => {
  const login = vi.fn((callback: (r: unknown) => void) => callback({ authResponse: { code: "local-code" } }));
  const sdk = { login, init: vi.fn() };
  vi.stubGlobal("FB", sdk);
  try {
    const settings = {
      ...state,
      signupVersion: "v5" as const,
      extras: {
        version: "v5" as const,
        features: [{ name: "whatsapp_business_app_onboarding" as const, enabled: false as const }] as [
          { name: "whatsapp_business_app_onboarding"; enabled: false }
        ],
      },
    };
    await platformSignup.prepare(settings);
    const capture = platformSignup.open(settings, new AbortController().signal);
    const event = (origin: string, business_id: string) =>
      new MessageEvent("message", {
        origin,
        data: {
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: { business_id, phone_number_id: "100004", messaging_account_ids: ["100005"], is_on_biz_app: false },
        },
      });
    window.dispatchEvent(event("https://fake.facebook.com", "999"));
    window.dispatchEvent(event("https://www.facebook.com", "100003"));
    expect(await capture).toMatchObject({ businessId: "100003", code: "local-code", messagingAccountIds: ["100005"] });
    expect(login.mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          config_id: state.configId,
          response_type: "code",
          extras: { ...settings.extras, setup: {} },
        }),
      ])
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
test("PROS-29 AC3 carregamento, falha e acesso negado suspendem ações do recurso", async () => {
  await exerciseReadFailure(
    (read) => <ProspectingChannelPage {...screenProps({ sender: read })} mode="disabled" />,
    "Conectar número Zyon"
  );
});

test("OWN-SENDER AC6 verifies the displayed own number and confirms without preparing or opening customer signup",async()=>{
 const ownState={...state,authorizationMethod:"system_user",existingSender:{businessId:"100003",wabaId:"100005",phoneNumberId:"100004",displayPhoneNumber:"+5521971191446"}};
 const sdk={prepare:vi.fn(),open:vi.fn()},connect=vi.fn<(body:Record<string,unknown>)=>Promise<typeof binding>>().mockResolvedValue({...binding,displayPhoneNumber:ownState.existingSender.displayPhoneNumber});
 const ui=await show(<ProspectingChannelPage {...screenProps({sender:async()=>({...sender,binding:null}),signupState:async()=>ownState,connect})} mode="controlled" controlledSdk={sdk}/>);
 await ui.click("Conectar número Zyon");expect(ui.text()).toContain(ownState.existingSender.displayPhoneNumber);expect(ui.text()).toContain("Número a conectar");expect(connect).not.toHaveBeenCalled();
 expect(sdk.prepare).not.toHaveBeenCalled();expect(sdk.open).not.toHaveBeenCalled();expect(ui.text()).not.toContain("Abrir autorização");
 await ui.click("Confirmar vínculo");expect(connect).toHaveBeenCalledTimes(1);expect(connect.mock.calls[0][0]).toMatchObject({authorizationMethod:"system_user",state:state.state});
 expect(Object.keys(connect.mock.calls[0][0]).sort()).toEqual(["authorizationMethod","clientRequestId","state"]);
 expect(ui.text()).toContain("Vínculo confirmado");expect(ui.text()).not.toContain("Número a conectar");expect(sdk.open).not.toHaveBeenCalled();
});

test("OWN-SENDER AC6 failed own confirmation clears the preview and allows a new authorized attempt",async()=>{
 const sdk={prepare:vi.fn(),open:vi.fn()},connect=vi.fn().mockRejectedValue(new PlatformApiError(409));
 const ownState={...state,authorizationMethod:"system_user",existingSender:{businessId:"100003",wabaId:"100005",phoneNumberId:"100004",displayPhoneNumber:"+5521971191446"}};
 const ui=await show(<ProspectingChannelPage {...screenProps({sender:async()=>({...sender,binding:null}),signupState:async()=>ownState,connect})} mode="controlled" controlledSdk={sdk}/>);
 await ui.click("Conectar número Zyon");await ui.click("Confirmar vínculo");expect(connect).toHaveBeenCalledTimes(1);expect(ui.text()).not.toContain("Número a conectar");expect(ui.button("Conectar número Zyon").disabled).toBe(false);expect(sdk.prepare).not.toHaveBeenCalled();
});

test("OWN-SENDER AC6 expired own-number preview cannot confirm a binding",async()=>{
 vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});try{
  const sdk={prepare:vi.fn(),open:vi.fn()},connect=vi.fn();
  const ownState={...state,expiresAt:new Date(Date.now()+1000).toISOString(),authorizationMethod:"system_user",existingSender:{businessId:"100003",wabaId:"100005",phoneNumberId:"100004",displayPhoneNumber:"+5521971191446"}};
  const ui=await show(<ProspectingChannelPage {...screenProps({sender:async()=>({...sender,binding:null}),signupState:async()=>ownState,connect})} mode="controlled" controlledSdk={sdk}/>);
  await ui.click("Conectar número Zyon");expect(ui.text()).toContain("Número a conectar");await act(async()=>{vi.advanceTimersByTime(2000);});expect(ui.text()).not.toContain("Confirmar vínculo");expect(ui.text()).toContain("A autorização expirou");expect(connect).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
