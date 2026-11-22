import { platformSignup } from "./platform-signup.js";
import { expect, test, vi } from "vitest";
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
