/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDashboardApi, type MerchantProfile } from "../api-client.js";
import { ApiContext } from "../hooks/useApi.js";
import { useConversationNavigation } from "../pages/whatsapp-seller/useConversationNavigation.js";
import { DashboardShell } from "./DashboardShell.js";

// DOM boundary proof only. Page spies reveal lazy import/mount attempts;
// unchanged T78 tests exercise the real page/VM/SDK, Browser proves real HTTP.
const observed = vi.hoisted(() => ({ attendanceImports: 0, appointmentImports: 0, navigation: null as unknown }));
vi.mock("../pages/service-attendance/ServiceAttendancePage.js", () => { observed.attendanceImports++; return { ServiceAttendancePage: ({ me }: { me: MerchantProfile }) => { const [initial] = useState(me.id + "/" + me.user_id); return <><section data-service-module="attendance" data-initial-scope={initial}>{me.id}</section><a href="#service-appointments?fromDate=2030-01-01&amp;toDate=2030-01-02">Abrir agendamentos</a></>; } }; });
vi.mock("../pages/service-appointments/ServiceAppointmentsPage.js", () => { observed.appointmentImports++; return { ServiceAppointmentsPage: ({ me }: { me: MerchantProfile }) => { const [initial] = useState(me.id + "/" + me.user_id); return <section data-service-module="appointments" data-initial-scope={initial}>{me.id}</section>; } }; });
vi.mock("../pages/support-settings-page.js", () => ({ SupportSettingsPage: () => <section data-old-support>Suporte existente</section> }));
vi.mock("../pages/whatsapp-seller/WhatsAppSellerPage.js", () => ({ WhatsAppSellerPage: ({ navigation }: { navigation: unknown }) => { observed.navigation = navigation; return <section data-old-whatsapp>WhatsApp existente</section>; } }));
vi.mock("../hooks/useSupportSocket.js", () => ({ useSupportSocket: () => ({ newTickets: [], clearNewTickets: () => {} }) }));
vi.mock("./useNavCounts.js", () => ({ useNavCounts: () => ({ counts: { orders: 0, messages: 0, cartRecovery: 0 }, markViewed: () => {} }) }));
vi.mock("../components/PlatformFeedbackFab.js", () => ({ PlatformFeedbackFab: () => null }));
vi.mock("../components/Toast.js", () => ({ showToast: vi.fn(), ToastContainer: () => null }));
vi.mock("../hooks/useErrorReporter.js", () => ({ reportError: vi.fn() }));
const me: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "Synthetic route", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected", plan: "API" };
const roots: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(async () => { for (const row of roots.splice(0)) { await act(async () => row.root.unmount()); row.host.remove(); } vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); localStorage.clear(); });
async function fixture(route: string, profile: MerchantProfile = me, required = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.history.replaceState(null, "", "/#" + route);
  const requests: string[] = [], fetcher = (async (input: RequestInfo | URL) => { const path = new URL(String(input)).pathname; requests.push(path);
    if (path.endsWith("/domains")) return Response.json([]); if (path.endsWith("/notifications")) return Response.json({ items: [] }); if (path.endsWith("/stores")) return Response.json({ data: [] });
    if (path.endsWith("/billing/subscription")) return Response.json({ plan: "starter", status: "active", features: {} });
    throw Error("Unexpected service-route unit request " + path);
  }) as typeof fetch;
  vi.stubGlobal("fetch", fetcher); const api = createDashboardApi({ baseUrl: "http://route.test", fetchImpl: fetcher });
  let lastNavigation: ReturnType<typeof useConversationNavigation> | null = null;
  function App({ value, subscriptionRequired }: { value: MerchantProfile; subscriptionRequired: boolean }) { const navigation = useConversationNavigation(1); lastNavigation = navigation; return <ApiContext.Provider value={api}><DashboardShell me={value} onLogout={() => {}} onboardingCompleted subscriptionRequired={subscriptionRequired} conversationNavigation={navigation} /></ApiContext.Provider>; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); roots.push({ root, host });
  async function render(value = profile, subscriptionRequired = required) { profile = value; required = subscriptionRequired; await act(async () => root.render(<App value={value} subscriptionRequired={subscriptionRequired} />)); await act(async () => { await vi.dynamicImportSettled(); }); }
  await render(); return { host, requests, render, navigation: () => lastNavigation };
}
const routes = ["service-attendance", "service-appointments"] as const;
async function settled(check: () => void) { await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); check(); }); }
const denied = [{ ...me, businessMode: "products" as const }, { ...me, role: "STAFF" as const }, { ...me, role: undefined }, { ...me, user_id: "" }, { ...me, businessMode: undefined }, { ...me, businessModeSelectionState: "review_required" as const }];
for (const route of routes) describe("T83 " + route + " explicit lazy boundary", () => {
  it.each(denied)("cold direct route denies before the corresponding lazy module and private reads %j", async profile => { const before = route === "service-attendance" ? observed.attendanceImports : observed.appointmentImports; const f = await fixture(route, profile);
    expect(f.host.textContent).toContain(route === "service-attendance" ? "Atendimento indisponível para esta conta" : "Agendamentos indisponíveis para esta conta");
    expect(f.host.querySelector('[data-service-module]')).toBeNull(); expect(route === "service-attendance" ? observed.attendanceImports : observed.appointmentImports).toBe(before);
    expect(f.requests.filter(path => /service-professionals|service-business-policy|service-appointments|\/customers$/.test(path))).toEqual([]);
  });
  it.each(["OWNER", "ADMIN"] as const)("allows a direct API-plan service %s under existing plan semantics", async role => { const f = await fixture(route, { ...me, role }); expect(f.host.querySelector('[data-service-module]')?.getAttribute("data-initial-scope")).toBe("merchant-a/owner-a"); });
  it("keeps the subscription boundary ahead of the lazy module", async () => { const f = await fixture(route, me, true); expect(f.host.textContent).toContain("Assinatura necessária"); expect(f.host.querySelector('[data-service-module]')).toBeNull(); expect(f.requests.filter(path => /service-professionals|service-business-policy|service-appointments/.test(path))).toEqual([]); });
  it("remounts local module state on merchant/user change and denies a subsequent product context", async () => { const f = await fixture(route); await f.render({ ...me, id: "merchant-b", user_id: "admin-b", role: "ADMIN" }); expect(f.host.querySelector('[data-service-module]')?.getAttribute("data-initial-scope")).toBe("merchant-b/admin-b"); expect(f.host.querySelector('[data-service-module]')?.textContent).toBe("merchant-b"); await f.render({ ...me, businessMode: "products" }); expect(f.host.querySelector('[data-service-module]')).toBeNull(); });
});
describe("T83 existing route continuity", () => {
  it("routes an ordinary service anchor through the shell in the current gesture and preserves its filters", async () => {
    const f = await fixture("service-attendance");
    const anchor = f.host.querySelector<HTMLAnchorElement>('a[href^="#service-appointments?"]')!;
    await act(async () => anchor.click());
    expect(window.location.hash).toBe("#service-appointments?fromDate=2030-01-01&toDate=2030-01-02");
    expect(f.host.querySelector('[data-service-module="appointments"]')).not.toBeNull();
    expect(f.host.querySelector('[data-service-module="attendance"]')).toBeNull();
  });

  it("preserves the support route and Back hash handling", async () => { const f = await fixture("service-attendance"); await act(async () => { window.location.hash = "support"; }); await settled(() => expect(f.host.querySelector('[data-old-support]')).not.toBeNull()); await act(async () => window.history.back()); await settled(() => expect(f.host.querySelector('[data-service-module="attendance"]')).not.toBeNull()); });
  it("passes the actual conversation navigation object unchanged to WhatsApp", async () => { const f = await fixture("whatsapp-seller"); expect(f.host.querySelector('[data-old-whatsapp]')).not.toBeNull(); expect(observed.navigation).toBe(f.navigation()); });
});
