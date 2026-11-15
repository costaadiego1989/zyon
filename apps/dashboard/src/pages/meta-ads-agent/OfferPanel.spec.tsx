// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import { OfferPanel } from "./OfferPanel.js";
import { overview } from "./fixtures.js";
import { ui } from "./test-helpers.js";
let screen: ReturnType<typeof ui>;
afterEach(async () => screen?.close());
test("offer requires a ready eligible store and checkout uses displayed exact quote", async () => {
  screen = ui(); const data = overview(); data.entitled = false;
  const checkout = vi.fn().mockResolvedValue({url: "https://checkout.stripe.com/c/pay"}); const navigate = vi.fn();
  const props = {overview: data, api: {checkout} as unknown as MetaAdsAgentApi, onUpdated: vi.fn(), navigate};
  data.offer.commercialReady = false; await screen.render(<OfferPanel {...props}/>);
  expect(screen.container.textContent).toContain("30 imagens");
  expect(screen.container.textContent).toContain("Verba dos anúncios paga diretamente à Meta");
  expect(screen.container.querySelector("button")?.disabled).toBe(true);
  data.offer.commercialReady = true; await screen.render(<OfferPanel {...props}/>);
  await screen.click("Contratar por R$ 149,00/mês");
  expect(checkout.mock.calls[0][0]).toMatchObject({kind: "subscription", offerVersion: "offer1"});
  expect(navigate).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay");
  expect(screen.container.textContent).toContain("Confirmação do pagamento pendente");
});
test("accepted offer survives global price change; extras and cancellation show exact consequences", async () => {
  screen = ui(); const data = overview(); data.subscription = {id: "sub1", offer: {...data.offer}, status: "active", provider: "stripe", currentPeriodStart: null, currentPeriodEnd: "2026-12-15T00:00:00Z", cancelAtPeriodEnd: false, acceptedAt: "2026-11-15"}; data.offer.monthlyPriceCents = 19900;
  const checkout = vi.fn().mockResolvedValue({url: "https://checkout.stripe.com/c/extra"}); const cancel = vi.fn().mockResolvedValue({...data.subscription, status: "cancel_at_period_end", cancelAtPeriodEnd: true});
  await screen.render(<OfferPanel overview={data} api={{checkout, cancel} as unknown as MetaAdsAgentApi} onUpdated={vi.fn()} navigate={vi.fn()}/>);
  expect(screen.container.textContent).toContain("149,00"); expect(screen.container.textContent).not.toContain("199,00");
  await screen.click("Comprar 10 imagens por R$ 39,00"); expect(checkout.mock.calls[0][0].offerVersion).toBe("offer1");
  await screen.click("Cancelar renovação"); expect(screen.container.textContent).toContain("continuar consumindo verba"); expect(cancel).not.toHaveBeenCalled();
  await screen.click("Confirmar cancelamento"); expect(screen.container.textContent).toContain("15/12/2026"); expect(screen.container.textContent).toContain("Renovação cancelada");
});
test("checkout blocks duplicate gestures and failure keeps price for review", async () => {
  screen = ui(); const data = overview(); data.entitled = false; let reject!: (e: Error) => void;
  const checkout = vi.fn(() => new Promise((_, no) => {reject = no;}));
  await screen.render(<OfferPanel overview={data} api={{checkout} as unknown as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
  await screen.click("Contratar por R$ 149,00/mês"); expect(screen.container.querySelector("button")!.disabled).toBe(true);
  await act(async () => {reject(new Error("offline"));});
  expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível");
  expect(screen.container.textContent).toContain("149,00"); expect(checkout).toHaveBeenCalledTimes(1);
});
