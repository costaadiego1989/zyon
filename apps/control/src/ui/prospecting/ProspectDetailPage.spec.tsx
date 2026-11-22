import { beforeAll, expect, test, vi } from "vitest";
import { useState } from "react";
import { ProspectDetailPage } from "./ProspectDetailPage.js";
import { exerciseReadFailure, screenProps, show } from "./screen-test.js";
import { ProspectCommandUnresolved } from "../../lib/prospecting-api.js";
import type { ProspectRoute } from "./ProspectingShell.js";
// jsdom supplies the element but does not implement the native modal top layer. Keyboard behavior runs in Chromium.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value() {
        this.removeAttribute("open");
      },
    });
  }
});
const record = {
  id: "lead",
  cnpj: "12ABC34501DE35",
  stage: "responded",
  assignedOperatorId: "Ana",
  version: 3,
  contacts: [
    {
      endpointId: "ep",
      identity: { kind: "bsuid", value: "opaque-a" },
      permission: "no_opt_in",
      confirmationState: "ambiguous",
    },
  ],
  firstAttemptAt: "2026-10-01T10:00:00Z",
  lastReplyPreview: "Quero informações",
  tags: [],
};
function detail() {
  return {
    prospect: record,
    company: {
      legalName: "Oficina Brasil",
      competence: "2026-10",
      contacts: [{ originalValue: "(11) 3333-1234", channel: "phone" }],
    },
    conversationId: null,
  };
}
test("PROS-25 AC1 lista abre ficha, mantém contatos distintos e pagina conversões verificadas", async () => {
  const conversions = vi
    .fn()
    .mockResolvedValueOnce({
      items: [
        {
          id: "unknown",
          state: "allocation_coverage_unknown",
          planKey: "growth",
          provider: "stripe",
        },
      ],
      nextCursor: "more",
    })
    .mockResolvedValueOnce({
      items: [
        { id: "paid", state: "paid", planKey: "growth", provider: "stripe" },
        {
          id: "refund",
          state: "refunded",
          planKey: "growth",
          provider: "stripe",
        },
      ],
      nextCursor: null,
    });
  const props = screenProps({
    prospects: async () => ({ items: [record], nextCursor: null }),
    prospect: async () => detail(),
    conversions,
  });
  function Flow() {
    const [route, navigate] = useState<ProspectRoute>({ area: "leads" });
    return <ProspectDetailPage {...props} route={route} navigate={navigate} />;
  }
  const ui = await show(<Flow />);
  await ui.click(record.cnpj);
  expect(ui.text()).toContain("Oficina Brasil");
  expect(ui.text()).toContain("2026-10");
  expect(ui.text()).toContain("Respondeu");
  expect(ui.text()).toContain("Ana");
  expect(ui.text()).toContain("Quero informações");
  expect(ui.text()).toContain("(11) 3333-1234");
  expect(ui.text()).toContain("opaque-a");
  expect(ui.text()).toContain("Sem opt-in");
  await ui.click("Conversões anteriores");
  expect(conversions.mock.calls[1][1].cursor).toBe("more");
  expect(ui.text()).toContain("Cobertura de alocação desconhecida");
  expect(ui.text()).toContain("Pagamento confirmado");
  expect(ui.text()).toContain("Reembolso integral");
});
test("PROS-25 AC3 somente confirmação persistida informa bloqueio e cancelamentos", async () => {
  const suppress = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValueOnce({
    suppressed: true,
    cancelledAttempts: 2,
    inFlightAttempts: 1,
  });
  const props = screenProps({
    prospects: async () => ({ items: [record], nextCursor: null }),
    prospect: vi
      .fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValue({
        ...detail(),
        prospect: { ...record, suppressed: true, stage: "do_not_contact" },
      }),
    conversions: async () => ({ items: [], nextCursor: null }),
    suppress,
  });
  const ui = await show(<ProspectDetailPage {...props} route={{ area: "leads", id: "lead" }} />);
  await ui.click("Não contatar");
  expect(suppress).not.toHaveBeenCalled();
  await ui.fill("Motivo do bloqueio", "Solicitação da empresa");
  await ui.click("Confirmar não contatar");
  expect(ui.text()).toContain("Não foi possível");
  expect(ui.text()).not.toContain("2 cancelada(s)");
  await ui.click("Confirmar não contatar");
  expect(suppress.mock.calls[1][1]).toMatchObject({
    expectedVersion: 3,
    reason: "Solicitação da empresa",
  });
  expect(ui.text()).toContain("2 cancelada(s)");
  expect(ui.text()).toContain("1 em andamento");
  expect(ui.text()).toContain("Contato bloqueado");
});

test("PROS-25 AC1 carregamento, falha e acesso negado suspendem ações do recurso", async () => {
  await exerciseReadFailure(
    (read) => (
      <ProspectDetailPage
        {...screenProps({
          prospects: async () => ({ items: [record], nextCursor: null }),
          prospect: read,
        })}
        route={{ area: "leads", id: "lead" }}
      />
    ),
    "Salvar lead"
  );
});

test("PROS-25 AC1 alterações de estágio e vínculo usam versão, evidência e retorno persistido", async () => {
  const saved = {
    ...record,
    stage: "qualified",
    assignedOperatorId: "operator-test",
    version: 4,
  };
  const bound = {
    ...saved,
    version: 5,
    contacts: [
      {
        ...record.contacts[0],
        confirmationState: "confirmed",
        permission: "no_opt_in",
      },
    ],
  };
  const prospect = vi
    .fn()
    .mockResolvedValueOnce(detail())
    .mockResolvedValueOnce({ ...detail(), prospect: saved })
    .mockResolvedValue({ ...detail(), prospect: bound });
  const updateProspect = vi.fn().mockResolvedValue(saved),
    bindContact = vi.fn().mockResolvedValue(bound);
  const props = screenProps({
    prospects: async () => ({ items: [record], nextCursor: null }),
    prospect,
    updateProspect,
    bindContact,
    conversions: async () => ({ items: [], nextCursor: null }),
  });
  const ui = await show(<ProspectDetailPage {...props} route={{ area: "leads", id: "lead" }} />);
  await ui.fill("Alterar estágio", "qualified");
  await ui.fill("Atribuir responsável", "operator-test");
  await ui.click("Salvar lead");
  expect(updateProspect.mock.calls[0][1]).toMatchObject({
    stage: "qualified",
    assignedOperatorId: "operator-test",
    expectedVersion: 3,
  });
  await ui.fill("Referência da evidência", "Atendimento confirmado");
  await ui.click("Confirmar identidade");
  expect(bindContact.mock.calls[0][1]).toMatchObject({
    expectedVersion: 4,
    endpointId: "ep",
    evidenceRef: "Atendimento confirmado",
  });
  expect(ui.text()).toContain("Vínculo confirmado");
  expect(ui.text()).toContain("Sem opt-in");
});

test("PROS-25 AC4 máscara do telefone na lista e na ficha conserva estrangeiro, BSUID e valor canônico", async () => {
  const phone = {
    ...record.contacts[0],
    identity: { kind: "phone", value: "+5511998765432" },
    channel: "whatsapp",
  };
  const lead = {
    ...record,
    contacts: [
      phone,
      {
        ...phone,
        endpointId: "foreign",
        identity: { kind: "phone", value: "+12025550123" },
      },
      {
        ...phone,
        endpointId: "opaque",
        identity: { kind: "bsuid", value: "5511999998888" },
      },
    ],
  };
  const company = {
    ...detail().company,
    contacts: [
      { channel: "phone", originalValue: "5533456789" },
      { channel: "phone", originalValue: "+55 (21) 3234-5678" },
    ],
  };
  const props = screenProps({
    prospects: async () => ({ items: [lead], nextCursor: null }),
    prospect: async () => ({ prospect: lead, company, conversationId: null }),
    conversions: async () => ({ items: [], nextCursor: null }),
  });
  function Flow() {
    const [route, navigate] = useState<ProspectRoute>({ area: "leads" });
    return <ProspectDetailPage {...props} route={route} navigate={navigate} />;
  }
  const ui = await show(<Flow />);
  expect(ui.text()).toContain("(11) 99876-5432");
  await ui.click(lead.cnpj);
  const dialog = ui.host.querySelector("dialog")!;
  for (const value of ["(11) 99876-5432", "(55) 3345-6789", "(21) 3234-5678", "+12025550123", "5511999998888"])
    expect(dialog.textContent).toContain(value);
  expect(dialog.textContent).not.toContain("+55");
  expect(lead.contacts[0].identity.value).toBe("+5511998765432");
});

test("PROS-25 AC5 ficha modal preserva filtro, página e recuperação do comando ao reabrir", async () => {
  const prospects = vi.fn(async (q) => ({
    items: [record],
    nextCursor: q.cursor ? null : "page-two",
  }));
  const command = vi.fn(async (key: string) => ({
    state: "completed",
    clientRequestId: key,
  }));
  const updateProspect = vi.fn(async (_id: string, cmd: { clientRequestId: string }) => {
    throw new ProspectCommandUnresolved(cmd.clientRequestId, "outcome_unknown");
  });
  const props = screenProps({
    prospects,
    prospect: async () => detail(),
    conversions: async () => ({ items: [], nextCursor: null }),
    command,
    updateProspect,
  });
  function Flow() {
    const [route, navigate] = useState<ProspectRoute>({ area: "leads" });
    return <ProspectDetailPage {...props} route={route} navigate={navigate} />;
  }
  const ui = await show(<Flow />);
  await ui.fill("Buscar por CNPJ", "12ABC");
  await ui.click("Pesquisar");
  await ui.click("Próxima página");
  const opener = ui.button(record.cnpj);
  await ui.click(record.cnpj);
  expect(ui.host.querySelector("dialog[open]")).not.toBeNull();
  expect(ui.button(record.cnpj)).toBe(opener);
  expect(ui.control("Buscar por CNPJ").value).toBe("12ABC");
  expect(prospects.mock.lastCall?.[0]).toMatchObject({
    search: "12ABC",
    cursor: "page-two",
  });
  await ui.click("Salvar lead");
  expect(ui.text()).toContain("A confirmação ainda está pendente.");
  await ui.click("Fechar ficha do lead");
  expect(ui.host.querySelector("dialog")).toBeNull();
  await ui.click(record.cnpj);
  expect(ui.text()).toContain("Consultar resultado");
  await ui.click("Consultar resultado do comando");
  expect(command.mock.calls[0][0]).toBe(updateProspect.mock.calls[0][1].clientRequestId);
  expect(ui.text()).toContain("Comando confirmado pelo servidor.");
});
