// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import type { MetaAdsMetrics, MetaAdsRecommendation } from "@zyon/shared-types";
import { CampaignInsights } from "./CampaignInsights.js";
import { campaign } from "./fixtures.js";
import { ui } from "./test-helpers.js";
let screen: ReturnType<typeof ui>;
afterEach(async () => screen?.close());
const metrics: MetaAdsMetrics = {campaignId: "campaign1", since: "2026-11-01", until: "2026-11-15", updatedAt: "2026-11-15T12:00:00Z", timezone: "America/Sao_Paulo", currency: "BRL", attributionWindow: "7d_click", source: "Meta + pagamentos", spendCents: 10000, attributedRevenueCents: 50000, confirmedRevenueCents: 30000, paidOrders: 3, conversations: 18, costPerPurchaseCents: 3333, roas: 5, contributionCents: null, costCoverage: "partial", stale: true, notes: []};
test("results distinguish conversations, confirmed orders and attributed revenue with coverage and freshness", async () => {
  screen = ui(); const c = campaign(); c.createdByAgent = false; c.managed = false; c.draft.name = "Zyon importada";
  await screen.render(<CampaignInsights campaign={c} metrics={metrics} recommendations={[]} entitled onEdit={vi.fn()} onPropose={vi.fn()}/>);
  expect(screen.container.textContent).toContain("Conversas18"); expect(screen.container.textContent).toContain("Compras pagas confirmadas3");
  expect(screen.container.textContent).toContain("Receita paga confirmadaR$ 300,00"); expect(screen.container.textContent).toContain("Receita atribuída pela MetaR$ 500,00");
  expect(screen.container.textContent).toContain("Contribuição após mídiaIndisponível"); expect(screen.container.textContent).toContain("parcial"); expect(screen.container.textContent).toContain("Dados desatualizados");
  expect(screen.container.textContent).toContain("America/Sao_Paulo"); expect(screen.container.textContent).toContain("7d_click"); expect(screen.container.textContent).toContain("sem prova de incremento causal");
  expect(screen.container.querySelectorAll("button")).toHaveLength(0); expect(screen.container.textContent).toContain("Somente análise");
});
test("recommendation shows priority, hypothesis and evidence and requires an explicit proposal gesture", async () => {
  screen = ui(); const recommendation: MetaAdsRecommendation = {id: "r1", campaignId: "campaign1", priority: "cost_per_purchase", hypothesis: "Reduzir investimento no conjunto com custo alto", evidence: {paidOrders: 3, costPerPurchaseCents: 3333}, proposedAction: "budget", proposedFields: {budget: {...campaign().draft.budget, amountCents: 1500}}, status: "pending_review", createdAt: "2026-11-15"}; const onPropose = vi.fn();
  await screen.render(<CampaignInsights campaign={campaign()} metrics={metrics} recommendations={[recommendation]} entitled onEdit={vi.fn()} onPropose={onPropose}/>);
  expect(screen.container.textContent).toContain("Custo por compra"); expect(screen.container.textContent).toContain(recommendation.hypothesis); expect(screen.container.textContent).toContain("33,33"); expect(onPropose).not.toHaveBeenCalled();
  await screen.click("Criar proposta para revisão"); expect(onPropose).toHaveBeenCalledWith(recommendation);
});
test("no metrics remains awaiting data and never invents zero revenue or a winner", async () => {
  screen = ui(); await screen.render(<CampaignInsights campaign={campaign()} recommendations={[]} entitled={false} onEdit={vi.fn()} onPropose={vi.fn()}/>);
  expect(screen.container.textContent).toContain("Aguardando dados"); expect(screen.container.textContent).not.toContain("R$ 0,00"); expect(screen.container.querySelectorAll("button")).toHaveLength(0);
});
