// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import { CampaignComposer } from "./CampaignComposer.js";
import { campaign, overview, product } from "./fixtures.js";
import { ui } from "./test-helpers.js";
let screen: ReturnType<typeof ui>;
afterEach(async () => screen?.close());
test("MGA-22 merchant selects store or WhatsApp and saves selected catalog products", async () => {
  screen = ui(); const saveCampaign = vi.fn(async (_id, draft) => ({...campaign(), draft})); const saved = vi.fn();
  await screen.render(<CampaignComposer overview={overview()} campaign={campaign()} api={{products: vi.fn().mockResolvedValue([product]), saveCampaign} as unknown as MetaAdsAgentApi} onSaved={saved} onUpdated={vi.fn()}/>);
  await screen.change("Destino", "whatsapp"); await screen.click("Salvar rascunho");
  expect(saved.mock.calls[0][0].draft).toMatchObject({destination: "whatsapp", variantIds: ["variant1"]});
  expect(screen.container.textContent).toContain("Rascunho salvo");
  await screen.change("Destino", "store"); await screen.click("Salvar rascunho"); expect(saved.mock.calls[1][0].draft.destination).toBe("store");
});
test("MGA-23 all four priorities describe required evidence and preserve merchant choice", async () => {
  screen = ui(); const saveCampaign = vi.fn(async (_id, draft) => ({...campaign(), draft}));
  await screen.render(<CampaignComposer overview={overview()} campaign={campaign()} api={{products: vi.fn().mockResolvedValue([product]), saveCampaign} as unknown as MetaAdsAgentApi} onSaved={vi.fn()} onUpdated={vi.fn()}/>);
  expect(screen.container.querySelector('select[aria-label="Prioridade"]')?.querySelectorAll("option")).toHaveLength(4);
  for (const [value, text] of [["paid_sales", "pagamentos confirmados"], ["cost_per_purchase", "gasto de mídia"], ["roas", "vendas informadas pela Meta"], ["contribution", "custos históricos"]]) {
    await screen.change("Prioridade", value); expect(screen.container.textContent).toContain(text);
  }
  await screen.click("Salvar rascunho"); expect(saveCampaign.mock.calls[0][1].priority).toBe("contribution");
});
test("MGA-27 five images require visible five-credit review and a separate confirmation", async () => {
  screen = ui(); const generate = vi.fn().mockResolvedValue({id: "gen1", status: "reserved", campaignId: "campaign1", requestedImages: 5, mediaIds: [], error: null});
  await screen.render(<CampaignComposer overview={overview()} campaign={campaign()} api={{products: vi.fn().mockResolvedValue([product]), generate} as unknown as MetaAdsAgentApi} onSaved={vi.fn()} onUpdated={vi.fn()}/>);
  await screen.change("Quantidade de imagens", "5"); await screen.click("Gerar criativos");
  expect(screen.container.textContent).toContain("Esta solicitação reserva 5 créditos"); expect(generate).not.toHaveBeenCalled();
  await screen.click("Confirmar geração de 5 imagens"); expect(generate.mock.calls[0].slice(0, 2)).toEqual(["campaign1", 5]);
  expect(screen.container.textContent).toContain("Geração aguardando processamento");
});
test("failed save preserves edited draft and insufficient quota never initiates generation or extra purchase", async () => {
  screen = ui(); const data = overview(); data.wallet.monthlyAvailable = 0;
  const saveCampaign = vi.fn().mockRejectedValue(new Error("offline")), generate = vi.fn();
  await screen.render(<CampaignComposer overview={data} campaign={campaign()} api={{products: vi.fn().mockResolvedValue([product]), saveCampaign, generate} as unknown as MetaAdsAgentApi} onSaved={vi.fn()} onUpdated={vi.fn()}/>);
  await screen.change("Nome da campanha", "Coleção editada"); await screen.click("Salvar rascunho");
  expect((screen.container.querySelector('[aria-label="Nome da campanha"]') as HTMLInputElement).value).toBe("Coleção editada");
  expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível");
  expect(screen.container.textContent).toContain("Saldo insuficiente"); expect(generate).not.toHaveBeenCalled();
});
