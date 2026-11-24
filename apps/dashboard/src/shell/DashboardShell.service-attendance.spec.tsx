/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDashboardApi, type MerchantProfile, type Product } from "../api-client.js";
import { ApiContext } from "../hooks/useApi.js";
import { DashboardShell } from "./DashboardShell.js";

// Unit wiring only: unrelated socket/chrome transports do not contact a server.
// The shell, duration field, ServiceAttendancePage, T59 guard, T74 hook and SDK stay real.
vi.mock("../hooks/useSupportSocket.js", () => ({ useSupportSocket: () => ({ newTickets: [], clearNewTickets: () => {} }) }));
vi.mock("./useNavCounts.js", () => ({ useNavCounts: () => ({ counts: { orders: 0, messages: 0, cartRecovery: 0 }, markViewed: () => {} }) }));
vi.mock("../components/PlatformFeedbackFab.js", () => ({ PlatformFeedbackFab: () => null }));
vi.mock("../components/Toast.js", () => ({ showToast: vi.fn(), ToastContainer: () => null }));
vi.mock("../hooks/useErrorReporter.js", () => ({ reportError: vi.fn() }));

// Compile the real lazy route entries before measuring unit wiring gestures.
// The served browser gate still covers cold production-chunk navigation.
beforeAll(async () => {
  await Promise.all([import("../pages/product-detail-page.js"), import("../pages/service-attendance/ServiceAttendancePage.js")]);
});

const me: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "Local", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected", plan: "STORE_ONLY" };
const stamp = "2026-11-17T00:00:00.000Z";
const product: Product = { id: "historical", merchantId: me.id, name: "Serviço existente", type: "service", isActive: true, metadata: { serviceType: "presencial", serviceSchedule: { timeZone: "America/Manaus", durationMinutes: 45, slots: [{ id: "old-slot", date: "2030-02-04", startTime: "10:30" }] } }, createdAt: stamp, updatedAt: stamp, variants: [{ id: "variant-a", sku: "consulta", attributes: {}, isActive: true, basePriceInCents: 5000, currency: "BRL", taxPercent: 0, stockQuantity: 0, stockReserved: 0, media: [] }] };
const professional = { id: "professional-a", merchantId: me.id, publicName: "Ana", publicProfile: {}, timeZone: "America/Manaus", version: 2, isActive: true, isPublished: true, services: [{ id: "link-a", productId: product.id, version: 1 }], createdAt: stamp, updatedAt: stamp };
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); localStorage.clear(); });
async function fixture(options: { profile?: MerchantProfile; hash?: string; subscriptionRequired?: boolean } = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.history.replaceState(null, "", "/" + (options.hash ?? "#product-detail?productId=historical"));
  const calls: Array<{ path: string; method: string }> = [];
  const f = (async (input, init) => {
    const url = new URL(String(input)), path = url.pathname, method = init?.method ?? "GET"; calls.push({ path, method });
    if (method !== "GET") throw new Error("Unexpected route-unit write " + path);
    if (path.endsWith("/domains")) return Response.json([]);
    if (path.endsWith("/notifications")) return Response.json({ items: [] });
    if (path.endsWith("/stores")) return Response.json({ data: [] });
    if (path.endsWith("/billing/subscription")) return Response.json({ plan: "starter", status: "active", features: {} });
    if (path.endsWith("/categories")) return Response.json([]);
    if (path.endsWith("/promotion")) return Response.json({ promotions: [] });
    if (path.endsWith("/products/historical")) return Response.json(product);
    if (path.endsWith("/products")) return Response.json({ products: [product], total: 1 });
    if (path.endsWith("/service-professionals")) return Response.json({ items: [professional], nextCursor: null });
    if (path.endsWith("/service-business-policy")) return Response.json({ status: "unconfigured", version: 0, policy: null });
    if (path.endsWith("/availability")) return Response.json({ professionalId: professional.id, version: 2, timeZone: professional.timeZone, rows: [{ id: "row-a", merchantId: me.id, professionalId: professional.id, weekday: 1, startMinute: 540, endMinute: 720, validFrom: null, validUntil: null, timeZone: professional.timeZone, isActive: true, version: 2, createdAt: stamp, updatedAt: stamp }], exceptions: [], nextCursor: null });
    throw new Error("Unexpected route-unit read " + path);
  }) as typeof fetch;
  vi.stubGlobal("fetch", f);
  const api = createDashboardApi({ baseUrl: "http://fixture.test", fetchImpl: f });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(<ApiContext.Provider value={api}><DashboardShell me={options.profile ?? me} onLogout={() => {}} onboardingCompleted subscriptionRequired={options.subscriptionRequired} /></ApiContext.Provider>));
  await act(async () => { await vi.dynamicImportSettled(); });
  return { host, calls };
}
const namedButton = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === text)!;
async function settled(check: () => void) { await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); check(); }); }
const managementCalls = (f: Awaited<ReturnType<typeof fixture>>) => f.calls.filter(call => /service-professionals|service-business-policy/.test(call.path));

describe("T78 main-shell route wiring, not native API or Browser acceptance", () => {
  it("follows the actual catalog duration link into one existing availability page and reads the chosen grade", async () => {
    const f = await fixture();
    try { await settled(() => expect(f.host.querySelector('a[href="#service-attendance?tab=availability"]')).not.toBeNull()); }
    catch (error) {
      try {
        const content = f.host.querySelector('[data-dashboard-page]') ?? f.host;
        const text = (node: Element | null, limit: number) => node?.textContent?.replace(/\s+/g, " ").trim().slice(0, limit) ?? null;
        const lastRequests = f.calls.slice(-24).map(row => ({ path: row.path.slice(0, 180), method: row.method.slice(0, 10) }));
        const fixtureReads = ["/domains", "/notifications", "/stores", "/billing/subscription", "/categories", "/promotion", "/products/historical", "/products", "/service-professionals", "/service-business-policy", "/availability"];
        console.error("T78 initial-link failure-only diagnostic", JSON.stringify({
          route: { hash: window.location.hash.slice(0, 240), renderedPage: content.getAttribute("data-dashboard-page"), mounted: f.host.isConnected },
          loading: { lazyFallback: Boolean(content.querySelector('[aria-label="Carregando página"]')), product: Boolean(text(content, 1200)?.includes("Carregando produto...")), busy: Array.from(content.querySelectorAll('[aria-busy="true"]')).slice(0, 8).map(node => ({ label: node.getAttribute("aria-label")?.slice(0, 80), text: text(node, 120) })) },
          headings: Array.from(content.querySelectorAll("h1,h2,h3")).slice(0, 8).map(node => text(node, 120)),
          alerts: Array.from(content.querySelectorAll('[role="alert"]')).slice(0, 6).map(node => text(node, 200)),
          statuses: Array.from(content.querySelectorAll('[role="status"]')).slice(0, 8).map(node => text(node, 120)),
          editor: { productDetailMounted: Boolean(content.querySelector(".product-detail")), durationInputPresent: Boolean(content.querySelector('input[type="number"][min="5"][max="480"]')), targetLinkPresent: Boolean(content.querySelector('a[href="#service-attendance?tab=availability"]')) },
          contentText: text(content, 1200), contentHtml: content.innerHTML.slice(0, 3000),
          requests: { total: f.calls.length, last: lastRequests, unhandledByFixture: lastRequests.filter(row => row.method !== "GET" || !fixtureReads.some(suffix => row.path.endsWith(suffix))) },
        }));
      } finally { throw error; }
    }
    const before = f.calls.filter(call => call.path.endsWith("/service-professionals")).length;
    await act(async () => (f.host.querySelector('a[href="#service-attendance?tab=availability"]') as HTMLAnchorElement).click());
    await act(async () => { await vi.dynamicImportSettled(); });
    try {
    await settled(() => expect(f.host.querySelector('[role="tabpanel"][id="service-attendance-availability"]')).not.toBeNull());
    } catch (error) {
      console.error("T78 post-link failure-only synthetic diagnostic", JSON.stringify({ hash: window.location.hash,
        renderedPage: f.host.querySelector('[data-dashboard-page]')?.getAttribute('data-dashboard-page'),
        headings: Array.from(f.host.querySelectorAll('h1,h2,h3')).map(node => node.textContent?.slice(0, 100)),
        panels: Array.from(f.host.querySelectorAll('[role="tabpanel"]')).map(node => ({ id: node.id, text: node.textContent?.slice(0, 400) })),
        statuses: Array.from(f.host.querySelectorAll('[role="status"],[role="alert"]')).map(node => node.textContent?.slice(0, 250)),
        lastReads: f.calls.slice(-12), body: f.host.querySelector('[data-dashboard-page]')?.textContent?.slice(0, 1800),
      })); throw error;
    }
    expect(window.location.hash).toBe("#service-attendance?tab=availability"); expect(f.host.textContent).toContain("Atendimento"); expect(f.calls.filter(call => call.path.endsWith("/service-professionals")).length - before).toBe(1);
    const select = f.host.querySelector<HTMLSelectElement>('select[aria-label="Profissional"]')!;
    await act(async () => { select.value = professional.id; select.dispatchEvent(new Event("change", { bubbles: true })); }); await act(async () => namedButton(f.host, "Consultar grade").click());
    expect(f.host.textContent).toContain("09:00–12:00"); expect(f.calls.some(call => call.path === "/v1/merchants/merchant-a/service-professionals/professional-a/availability")).toBe(true); expect(f.calls.every(call => call.method === "GET")).toBe(true);
  });
  it("renders the already implemented professional panel through its real tab", async () => {
    const f = await fixture({ hash: "#service-attendance?tab=availability" }); await settled(() => expect(namedButton(f.host, "Profissionais")).toBeDefined());
    await act(async () => namedButton(f.host, "Profissionais").click()); expect(f.host.querySelector('[role="tabpanel"][id="service-attendance-professionals"]')?.textContent).toContain("Ana"); expect(namedButton(f.host, "Novo profissional")).toBeDefined(); expect(f.calls.some(call => /appointments|payments/.test(call.path))).toBe(false);
  });
  it("honors a direct availability deep link without mounting a second management hook", async () => {
    const f = await fixture({ hash: "#service-attendance?tab=availability&professionalId=professional-a" }); await settled(() => expect(namedButton(f.host, "Consultar grade")).toBeDefined());
    expect(f.calls.filter(call => call.path.endsWith("/service-professionals"))).toHaveLength(1); expect(f.calls.filter(call => call.path.endsWith("/service-business-policy"))).toHaveLength(1);
  });
  it("uses the shell hash listener when Back returns from the management link to the saved editor", async () => {
    const f = await fixture(); await settled(() => expect(f.host.querySelector('a[href="#service-attendance?tab=availability"]')).not.toBeNull());
    await act(async () => (f.host.querySelector('a[href="#service-attendance?tab=availability"]') as HTMLAnchorElement).click()); await settled(() => expect(f.host.querySelector('[id="service-attendance-availability"]')).not.toBeNull());
    await act(async () => window.history.back()); await settled(() => expect(window.location.hash).toBe("#product-detail?productId=historical")); await settled(() => expect(f.host.querySelector('a[href="#service-attendance?tab=availability"]')).not.toBeNull());
    expect(f.calls.every(call => call.method === "GET")).toBe(true);
  });
  it.each([{ ...me, businessMode: "products" as const }, { ...me, role: "STAFF" as const }, { ...me, user_id: "" }, { ...me, businessModeSelectionState: "review_required" as const }])("denies the sensitive page before management reads for %j", async profile => {
    const f = await fixture({ profile, hash: "#service-attendance?tab=availability" }); await settled(() => expect(f.host.textContent).toContain("Atendimento indisponível para esta conta")); expect(managementCalls(f)).toEqual([]);
  });
  it("keeps the existing subscription gate ahead of the management page", async () => {
    const f = await fixture({ hash: "#service-attendance?tab=availability", subscriptionRequired: true }); expect(f.host.textContent).toContain("Assinatura necessária"); expect(managementCalls(f)).toEqual([]); expect(f.host.querySelector('[role="tabpanel"]')).toBeNull();
  });
});
