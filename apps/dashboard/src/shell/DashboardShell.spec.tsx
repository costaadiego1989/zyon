// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MerchantProfile } from "../api-client.js";
import { DashboardShell } from "./DashboardShell.js";
import { ui } from "../pages/meta-ads-agent/test-helpers.js";
const stable = vi.hoisted(() => ({tickets: [], markViewed: vi.fn(), clearNewTickets: vi.fn()}));
vi.mock("../hooks/useSupportSocket.js", () => ({useSupportSocket: () => ({newTickets: stable.tickets, clearNewTickets: stable.clearNewTickets})}));
vi.mock("./useNavCounts.js", () => ({useNavCounts: () => ({counts: {}, markViewed: stable.markViewed})}));
vi.mock("../hooks/api/useCatalogApi.js", () => ({useCatalogApi: () => ({getImportJob: vi.fn()})}));
vi.mock("../api/http/client.js", () => ({dashboardFetch: async () => new Response("[]")}));
vi.mock("../components/FeatureGate.js", () => ({PlanProvider: ({children}: {children: ReactNode}) => children}));
vi.mock("../components/PremiumFeatureGate.js", () => ({PremiumFeatureGate: () => <p>Recurso exclusivo do Escala</p>}));
vi.mock("../components/PlatformFeedbackFab.js", () => ({PlatformFeedbackFab: () => null}));
vi.mock("../pages/billing-plans/FreeTrialNotice.js", () => ({FreeTrialNotice: () => null}));
vi.mock("./MerchantStoreSwitcher.js", () => ({MerchantStoreSwitcher: () => null}));
vi.mock("../pages/revenue-manager/StrategyReviewModal.js", () => ({StrategyReviewModal: () => null}));
vi.mock("../pages/overview/index.js", () => ({OverviewPage: () => <h1>Início da loja</h1>}));
vi.mock("../pages/meta-ads-agent/index.js", () => ({MetaAdsAgentPage: ({merchantId, apiBaseUrl}: {merchantId: string; apiBaseUrl: string}) => <div data-module="meta-ads" data-merchant={merchantId} data-api={apiBaseUrl}>Módulo de anúncios</div>}));
let screen: ReturnType<typeof ui>;
beforeEach(() => {localStorage.clear(); localStorage.setItem("aacp_nav_collapsed", "[]"); window.history.replaceState({}, "", "/"); screen = ui();});
afterEach(async () => {await screen.close(); window.history.replaceState({}, "", "/");});
const merchant = {id: "store-growth", name: "Loja Growth", role: "ADMIN", plan: "BOTH", onboardingCompleted: true} as unknown as MerchantProfile;
test("merchant clicks Ads with AI and receives scoped module without a Scale feature gate", async () => {
  await screen.render(<DashboardShell me={merchant} initialTab="overview" onLogout={vi.fn()} onboardingCompleted/>);
  await screen.click("Anúncios com IA");
  expect(screen.container.querySelector('[data-module="meta-ads"]')?.getAttribute("data-merchant")).toBe("store-growth");
  expect(screen.container.querySelector('[data-module="meta-ads"]')?.getAttribute("data-api")).toMatch(/^http/);
  expect(screen.container.textContent).not.toContain("Recurso exclusivo do Escala");
});
test("Meta OAuth and Stripe return query opens module without consuming OAuth code", async () => {
  window.history.replaceState({}, "", "/?tab=meta-ads-agent&code=one-use-code&state=actor-state");
  await screen.render(<DashboardShell me={merchant} onLogout={vi.fn()} onboardingCompleted/>);
  expect(screen.container.querySelector('[data-module="meta-ads"]')).not.toBeNull();
  expect(new URLSearchParams(window.location.search).get("code")).toBe("one-use-code");
});
test("staff cannot reach the module through its direct hash route", async () => {
  window.history.replaceState({}, "", "/#meta-ads-agent");
  await screen.render(<DashboardShell me={{...merchant, role: "STAFF"}} onLogout={vi.fn()} onboardingCompleted/>);
  expect(screen.container.querySelector('[data-module="meta-ads"]')).toBeNull();
  expect(screen.container.textContent).toContain("Acesso restrito");
});
