// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import type { MetaAdsOverview } from "@zyon/shared-types";
import { MetaAdsAgentPage } from "./index.js";
import { campaign, overview, product, proposal } from "./fixtures.js";
import { ui } from "./test-helpers.js";
let screen: ReturnType<typeof ui>;
afterEach(async () => screen?.close());
const apiFor = (data: MetaAdsOverview) => ({overview: vi.fn().mockResolvedValue(data), products: vi.fn().mockResolvedValue([product]), existing: vi.fn().mockResolvedValue([{id: "999", name: "Campanha existente", status: "ACTIVE"}])});
test("MGA-69 empty state offers real first-campaign and existing-analysis gestures", async () => {
  screen = ui(); const api = apiFor(overview());
  await screen.render(<MetaAdsAgentPage merchantId="store1" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/>);
  expect(screen.container.textContent).toContain("Sua primeira campanha começa aqui");
  await screen.click("Preparar primeira campanha"); expect(screen.container.querySelector('[aria-label="Nome da campanha"]')).not.toBeNull();
  await screen.click("Analisar campanhas existentes"); expect(screen.container.textContent).toContain("Campanha existente"); expect(screen.container.textContent).toContain("Somente análise");
});
test("MGA-70 loading is visible and a pending proposal cannot be sent twice", async () => {
  screen = ui(); const data = overview(); data.campaigns = [campaign()]; let loaded!: (d: MetaAdsOverview) => void; let proposed!: (p: ReturnType<typeof proposal>) => void;
  const api = {...apiFor(data), overview: vi.fn(() => new Promise<MetaAdsOverview>(yes => {loaded = yes;})), propose: vi.fn(() => new Promise<ReturnType<typeof proposal>>(yes => {proposed = yes;}))};
  await screen.render(<MetaAdsAgentPage merchantId="store1" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/>);
  expect(screen.container.querySelector('[role="status"]')?.textContent).toContain("Carregando");
  await act(async () => {loaded(data);}); api.overview.mockResolvedValue(data);
  await screen.click("Abrir campanha Coleção Aurora"); await screen.change("Motivo da alteração", "Revisar estrutura"); await screen.click("Criar proposta");
  expect((screen.container.querySelector('[data-action="propose"]') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.container.textContent).toContain("Preparando proposta"); expect(api.propose).toHaveBeenCalledTimes(1);
  await act(async () => {proposed(proposal());}); expect(screen.container.textContent).toContain("Proposta criada para revisão");
});
test("MGA-71 failed saves and overview recovery retain the edited saved campaign", async () => {
  screen = ui(); const data = overview(); data.campaigns = [campaign()]; const api = {...apiFor(data), saveCampaign: vi.fn().mockRejectedValue(new Error("offline"))};
  await screen.render(<MetaAdsAgentPage merchantId="store1" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/>);
  await screen.click("Abrir campanha Coleção Aurora"); await screen.click("Editar campanha"); await screen.change("Nome da campanha", "Nome preservado"); await screen.click("Salvar rascunho");
  expect((screen.container.querySelector('[aria-label="Nome da campanha"]') as HTMLInputElement).value).toBe("Nome preservado");
  api.overview.mockRejectedValueOnce(new Error("offline")); await screen.click("Atualizar dados");
  expect(screen.container.textContent).toContain("Não foi possível atualizar"); expect((screen.container.querySelector('[aria-label="Nome da campanha"]') as HTMLInputElement).value).toBe("Nome preservado");
  await screen.click("Tentar atualizar novamente"); expect(screen.container.textContent).not.toContain("Não foi possível atualizar"); expect((screen.container.querySelector('[aria-label="Nome da campanha"]') as HTMLInputElement).value).toBe("Nome preservado");
});
test("changing active store discards a late response from the previous merchant", async () => {
  screen = ui(); let old!: (d: MetaAdsOverview) => void; const first = {...apiFor(overview()), overview: vi.fn(() => new Promise<MetaAdsOverview>(yes => {old = yes;}))}; const next = overview(); next.wallet.monthlyAvailable = 7;
  await screen.render(<MetaAdsAgentPage merchantId="old" apiBaseUrl="https://api.example.test" api={first as unknown as MetaAdsAgentApi}/>);
  await screen.render(<MetaAdsAgentPage merchantId="next" apiBaseUrl="https://api.example.test" api={apiFor(next) as unknown as MetaAdsAgentApi}/>);
  const stale = overview(); stale.campaigns = [campaign()]; await act(async () => old(stale));
  expect(screen.container.textContent).not.toContain("Coleção Aurora"); expect(screen.container.textContent).toContain("Sua primeira campanha começa aqui"); expect(screen.container.textContent).toContain("Imagens do mês disponíveis7");
});
test("a prepared campaign offers a separate publication proposal after refreshed remote state", async () => {
  screen = ui(); const data = overview(); data.campaigns = [campaign()]; const api = {...apiFor(data), propose: vi.fn().mockResolvedValue(proposal())};
  await screen.render(<MetaAdsAgentPage merchantId="store1" apiBaseUrl="https://api.example.test" api={api as unknown as MetaAdsAgentApi}/>);
  await screen.click("Abrir campanha Coleção Aurora");
  api.overview.mockResolvedValue({...data, campaigns: [{...campaign(), remoteCampaignId: "999", status: "remote_paused"}]});
  await screen.click("Atualizar dados");
  expect((screen.container.querySelector('[aria-label="Alteração"]') as HTMLSelectElement).value).toBe("publish");
  await screen.change("Motivo da alteração", "Publicar após revisão"); await screen.click("Criar proposta");
  expect(api.propose.mock.calls[0][1].kind).toBe("publish");
});
