import { useState } from "react";
import { expect, test, vi } from "vitest";
import { ProspectingOverview } from "./ProspectingOverview.js";
import { exerciseReadFailure, screenProps, show } from "./screen-test.js";
import type { ProspectRoute } from "./ProspectingShell.js";
const from = "2026-11-01T00:00:00.000Z",
  to = "2026-12-01T00:00:00.000Z";
const m = {
  campaignId: "camp",
  from,
  to,
  updatedAt: "2026-11-22T12:00:00Z",
  leads: 12,
  attempts: 10,
  accepted: 8,
  delivered: 7,
  uniqueReplies: 2,
  signups: 1,
  trials: 1,
  paidSubscriptions: 0,
  refundedSubscriptions: 1,
  unknownAllocationEvents: 3,
  responseRate: {
    numerator: 2,
    denominator: 6,
    population: "unique_delivered_endpoints",
    cohortUpdatedAt: "2026-11-22T12:00:00Z",
  },
  costs: {
    coverage: "partial",
    totals: [],
    missing: ["final_provider_charges", "unsettled_usage"],
    commitments: [
      { source: "model", state: "unknown", amountCents: "900719925474099317", entries: 1, currency: "BRL" },
    ],
  },
};
const common = {
  metrics: async () => m,
  campaigns: async () => ({ items: [{ id: "camp", name: "Oficinas" }], nextCursor: null }),
};
test("PROS-30 AC1 funil e custos mostram coorte, compromissos e cobertura desconhecida", async () => {
  const ui = await show(
    <ProspectingOverview
      {...screenProps(common)}
      route={{ area: "overview", filters: { campaignId: "camp", from, to } }}
    />
  );
  expect(ui.text()).toContain("2 de 6");
  expect(ui.text()).toContain("33,3%");
  expect(ui.text()).toContain("22/11/2026");
  expect(ui.text()).toContain("Alocação financeira desconhecida");
  expect(ui.text()).toContain("9.007.199.254.740.993,17");
  expect(ui.text()).toContain("Parcial");
  expect(ui.text()).toContain("Cobranças finais indisponíveis");
});
test("PROS-30 AC2 abrir indicador preserva período/campanha e exibe registros reais da consulta", async () => {
  const metricRecords = vi
    .fn()
    .mockResolvedValue({
      items: [{ id: "event", cnpj: "12ABC34501DE35", prospectId: "p", occurredAt: from }],
      nextCursor: null,
    });
  const props = screenProps({ ...common, metricRecords });
  function Flow() {
    const [route, navigate] = useState<ProspectRoute>({ area: "overview", filters: { campaignId: "camp", from, to } });
    return <ProspectingOverview {...props} route={route} navigate={navigate} />;
  }
  const ui = await show(<Flow />);
  await ui.click("Reembolsos integrais");
  expect(metricRecords.mock.calls[0][0]).toMatchObject({
    metric: "refundedSubscriptions",
    from,
    to,
    campaignId: "camp",
  });
  expect(ui.text()).toContain("12ABC34501DE35");
  expect(ui.text()).toContain("Reembolsos integrais");
  await ui.click("Voltar ao funil");
  expect(ui.text()).toContain("2 de 6");
});

test("PROS-30 AC1 carregamento, falha e acesso negado suspendem ações do recurso", async () => {
  await exerciseReadFailure(
    (read) => <ProspectingOverview {...screenProps({ ...common, metrics: read })} route={{ area: "overview" }} />,
    "Contatos que responderam"
  );
});
