import { expect, test, vi } from "vitest";
import { CampaignDetailPage } from "./CampaignDetailPage.js";
import { ProspectCommandUnresolved } from "../../lib/prospecting-api.js";
import { exerciseReadFailure, screenProps, show } from "./screen-test.js";
import type { ProspectMetricsQuery } from "@zyon/shared-types";
const base = { id: "campaign", name: "Campanha local", state: "running", revision: 4, recipientCount: 2, blockers: [] };

const campaignMetrics = {
  campaignId: base.id, from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z",
  updatedAt: "2026-11-22T15:00:00Z", leads: 32, attempts: 21, accepted: 18, delivered: 15,
  uniqueReplies: 6, signups: 4, trials: 3, paidSubscriptions: 0, refundedSubscriptions: 1,
  unknownAllocationEvents: 2,
  responseRate: {numerator: 6, denominator: 15, population: "unique_delivered_endpoints", cohortUpdatedAt: "2026-11-22T14:00:00Z"},
  costs: {coverage: "partial", totals: [], missing: ["final_provider_charges"], commitments: []},
};

test("PROS-UI métricas da campanha consultam seu identificador e exibem os valores inclusive zero", async () => {
  const metrics = vi.fn(async (query: ProspectMetricsQuery) => ({...campaignMetrics, campaignId: query.campaignId}));
  const ui = await show(<CampaignDetailPage {...screenProps({campaign: async () => base, recipients: async () => ({items: [], nextCursor: null}), metrics})} id={base.id} />);
  expect(ui.text()).toContain("Métricas da campanha");
  expect(metrics.mock.calls[0][0]).toMatchObject({campaignId: base.id});
  for (const [label,total] of Object.entries({"Leads":"32", "Entregas":"15", "Contatos que responderam":"6", "Assinaturas pagas líquidas":"0"}))
    expect(ui.button(label).parentElement?.querySelector("strong")?.textContent).toBe(total);
  expect(ui.text()).toContain("40%");
  expect(ui.text()).toContain("Parcial");
});

test("PROS-UI período e detalhamento da campanha mantêm o escopo sem afetar outras campanhas", async () => {
  const metrics = vi.fn(async (query: ProspectMetricsQuery) => ({...campaignMetrics,...query}));
  const props = screenProps({campaign: async () => base, recipients: async () => ({items: [], nextCursor: null}), metrics});
  const ui = await show(<CampaignDetailPage {...props} id={base.id} />);
  await ui.fill("Início (UTC)","2026-11-03");
  await ui.fill("Fim exclusivo (UTC)","2026-11-27");
  await ui.click("Aplicar período");
  const period={from:"2026-11-03T00:00:00.000Z",to:"2026-11-27T00:00:00.000Z",campaignId:base.id};
  expect(metrics.mock.calls.at(-1)?.[0]).toEqual(period);
  await ui.click("Entregas");
  expect(props.navigate).toHaveBeenLastCalledWith({area:"overview",id:"delivered",filters:period});
});

test("PROS-UI atualizar resultados preserva o período escolhido da campanha", async () => {
  const metrics = vi.fn(async (query: ProspectMetricsQuery) => ({...campaignMetrics,...query}));
  const ui = await show(<CampaignDetailPage {...screenProps({campaign: async () => base, recipients: async () => ({items: [], nextCursor: null}), metrics})} id={base.id} />);
  await ui.fill("Início (UTC)","2026-11-03");
  await ui.fill("Fim exclusivo (UTC)","2026-11-27");
  await ui.click("Aplicar período");
  await ui.click("Atualizar resultados");
  expect(metrics.mock.calls.at(-1)?.[0]).toEqual({from:"2026-11-03T00:00:00.000Z",to:"2026-11-27T00:00:00.000Z",campaignId:base.id});
  expect(ui.control("Início (UTC)").value).toBe("2026-11-03");
  expect(ui.control("Fim exclusivo (UTC)").value).toBe("2026-11-27");
});
test("PROS-26 AC3 pausa e retoma por revisão, consulta comando interrompido sem reenviar destinatário", async () => {
  const current = { ...base };
  const pauseOrResume = vi.fn(async (_id, cmd) => {
    if (cmd.action === "pause") {
      current.state = "paused";
      throw new ProspectCommandUnresolved(cmd.clientRequestId, "outcome_unknown");
    }
    current.state = "running";
    return { ...current };
  });
  const recipients = vi.fn(async (_id, cursor) => ({
    items: cursor
      ? [
          {
            id: "r2",
            frozenSnapshot: { cnpj: "00000000000191" },
            eligibility: "no_opt_in",
            blockers: ["no_opt_in"],
            state: "blocked",
          },
        ]
      : [
          {
            id: "r1",
            frozenSnapshot: { cnpj: "12ABC34501DE35" },
            eligibility: "opted_in",
            blockers: [],
            state: "outcome_unknown",
            followUpDueAt: "2026-11-04T10:00:00Z",
          },
        ],
    nextCursor: cursor ? null : "more",
  }));
  const command = vi.fn(async (key) => ({ state: "completed", clientRequestId: key }));
  const props = screenProps({ campaign: async () => ({ ...current }), recipients, pauseOrResume, command });
  const ui = await show(<CampaignDetailPage {...props} id={base.id} />);
  expect(ui.text()).toContain("Resultado desconhecido");
  expect(ui.text()).toContain("04/11/2026");
  await ui.click("Pausar campanha");
  expect(ui.text()).toContain("pendente");
  await ui.click("Consultar resultado do comando");
  expect(command.mock.calls[0][0]).toBe(pauseOrResume.mock.calls[0][1].clientRequestId);
  expect(ui.text()).toContain("Pausada");
  await ui.click("Retomar campanha");
  expect(pauseOrResume.mock.calls[1][1]).toMatchObject({ expectedRevision: 4, action: "resume" });
  expect(ui.text()).toContain("Em execução");
  expect(ui.text()).not.toContain("Reenviar");
  await ui.click("Próxima página");
  expect(ui.text()).toContain("Sem opt-in");
  expect(ui.text()).toContain("00000000000191");
});

test("PROS-26 AC3 carregamento, falha e acesso negado suspendem ações do recurso", async () => {
  await exerciseReadFailure(
    (read) => (
      <CampaignDetailPage
        {...screenProps({ recipients: async () => ({ items: [], nextCursor: null }), campaign: read })}
        id="local"
      />
    ),
    "Pausar campanha"
  );
});
