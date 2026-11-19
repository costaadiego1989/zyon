/** @vitest-environment jsdom */
import React, { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../main.js";
import { createDashboardApi, SESSION_EXPIRED_EVENT } from "../../api-client.js";
import { ApiContext } from "../../hooks/useApi.js";

// Main, Shell, URL hook, queue, SDK and composer are real. Only the entry root,
// unrelated Shell integrations and socket transport are isolated here.
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {} }) }));
const socket = vi.hoisted(() => ({ connected: true, newTickets: [], clearNewTickets: () => {},
  joinTicket: () => {}, leaveTicket: () => {}, onNewMessage: () => () => {},
  onCaseUpdated: () => () => {}, onConnected: () => () => {} }));
vi.mock("../../hooks/useSupportSocket.js", () => ({ useSupportSocket: () => socket }));
vi.mock("../../shell/useNavCounts.js", () => ({ useNavCounts: () => ({ counts: { orders: 0, messages: 0, cartRecovery: 0 }, markViewed: () => {} }) }));
vi.mock("../../hooks/api/useCatalogApi.js", () => ({ useCatalogApi: () => ({ getImportJob: async () => null }) }));
vi.mock("../../components/PlatformFeedbackFab.js", () => ({ PlatformFeedbackFab: () => null }));
vi.mock("../../components/Toast.js", () => ({ ToastContainer: () => null }));
vi.mock("../../components/NotificationBell.js", () => ({ NotificationBell: () => null }));
vi.mock("../../components/RestrictedAccessModal.js", () => ({ RestrictedAccessModal: () => null }));
vi.mock("../../components/spreadsheet-import/ImportProgressProvider.js", () => ({ ImportProgressProvider: (props: { children: React.ReactNode }) => props.children }));
vi.mock("../../components/spreadsheet-import/ImportProgressBanner.js", () => ({ ImportProgressBanner: () => null }));
vi.mock("../../shell/MerchantStoreSwitcher.js", () => ({ MerchantStoreSwitcher: () => null }));
vi.mock("../revenue-manager/StrategyReviewModal.js", () => ({ StrategyReviewModal: () => null }));
vi.mock("../billing-plans/FreeTrialNotice.js", () => ({ FreeTrialNotice: () => null }));
vi.mock("../overview/index.js", async () => { const { createElement: h } = await import("react"); return { OverviewPage: () => h("h1", null, "Overview page") }; });
vi.mock("../../auth/AuthScreen.js", async () => { const { createElement: h } = await import("react"); return { AuthScreen: () => h("h1", null, "Login screen") }; });

const mounts: Array<{ root: Root; host: HTMLElement }> = [];
let observedHash: (() => void) | undefined;
const observeHash = () => observedHash?.();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/notifications")) return Response.json({ items: [] });
    if (path.endsWith("/domains")) return Response.json([]);
    throw Error("unexpected_shell_transport:" + path);
  });
  window.addEventListener("hashchange", observeHash, true);
});
afterEach(async () => {
  for (const item of mounts.splice(0)) { await act(async () => item.root.unmount()); item.host.remove(); }
  window.removeEventListener("hashchange", observeHash, true); observedHash = undefined; vi.unstubAllGlobals();
});
const listHash = "#whatsapp-seller?tab=conversations";
const detailHash = listHash + "&ticketId=ticket-a";
const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent?.trim() === text)!;
async function hashGesture(gesture: () => void) {
  await act(async () => { const changed = new Promise<void>(resolve => { observedHash = resolve; }); gesture(); await changed; observedHash = undefined; });
}
async function click(text: string) { await act(async () => button(text).click()); }
async function settledAt(hash: string, visibleText: string) {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(window.location.hash).toBe(hash);
    expect(document.body.textContent).toContain(visibleText);
  });
  expect(document.body.textContent).toContain(visibleText);
}
async function enter(value: string) {
  const textarea = document.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function fixture(options: { owner?: boolean; list?: boolean } = {}) {
  window.history.pushState({ unrelated: "preserve-me" }, "", "/" + (options.list ? listHash : detailHash));
  const requests: Array<{ method: string; path: string }> = [];
  const row = (id: string) => ({ id, status: "in_progress", buyerMessage: "Buyer " + id, createdAt: "2026-11-19T10:00:00Z", updatedAt: "2026-11-19T10:00:00Z",
    binding: { id: "binding-" + id, ticketId: id, mode: "human", epoch: 2, assignedOperatorId: "operator-a" } });
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET"; requests.push({ method, path: url.pathname + url.search });
    if (url.pathname === "/v1/merchants/me") return options.owner ? Response.json({ id: "merchant-a", userId: "operator-a", name: "Owner shop", role: "owner", plan: "BOTH", businessMode: "products" }) : Response.json({}, { status: 403 });
    if (url.pathname.endsWith("/conversations/context")) return Response.json({ merchant_id: "merchant-a", user_id: "operator-a", role: options.owner ? "OWNER" : "STAFF" });
    if (url.pathname.endsWith("/conversations")) return Response.json({ data: [row("ticket-a"), row("ticket-b")], has_more: false, next_cursor: null });
    const selected = /\/conversations\/(ticket-[ab])$/.exec(url.pathname)?.[1];
    if (selected && method === "GET") return Response.json({ ticket: row(selected), binding: { ...row(selected).binding, configId: "config-a", whatsappSessionId: "session-" + selected },
      channel: { id: "config-a", provider: "META_CLOUD", enabled: true, status: "ACTIVE" }, messages: [{ id: "message-" + selected, ticketId: selected, senderType: "buyer", content: "History " + selected, createdAt: "2026-11-19T10:00:00Z" }], has_more: false, next_cursor: null });
    if (url.pathname === "/v1/auth/logout") return Response.json({});
    if (options.owner && url.pathname === "/v1/merchants/me/store-settings") return Response.json({});
    if (options.owner && url.pathname === "/v1/billing/subscription") return Response.json({ trial_expired: false });
    if (options.owner && url.pathname === "/v1/onboarding") return Response.json({ completed: true });
    throw Error("unexpected_navigation_test_request:" + method + url.pathname);
  } });
  const { createRoot } = await vi.importActual<typeof import("react-dom/client")>("react-dom/client");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(<ApiContext.Provider value={api}><App api={api} /></ApiContext.Provider>));
  await act(async () => vi.dynamicImportSettled());
  return { requests };
}
const noMessagesSubmitted = (requests: Array<{ method: string; path: string }>) => expect(requests.filter(value => value.method === "POST" && value.path.includes("/conversations/"))).toEqual([]);

describe("T62 navigation preserves a draft until explicit discard", () => {
  it("removing ticketId by an external hash keeps the original conversation and draft after cancel", async () => {
    const f = await fixture(); await enter("Draft A");
    await hashGesture(() => { window.location.hash = listHash; });
    await settledAt(detailHash, "Continuar editando");
    expect(document.body.textContent).toContain("Continuar editando"); expect(document.body.textContent).toContain("History ticket-a");
    expect(window.location.hash).toBe(detailHash); expect(window.history.state).toMatchObject({ unrelated: "preserve-me" });
    await click("Continuar editando"); expect(document.querySelector("textarea")!.value).toBe("Draft A"); noMessagesSubmitted(f.requests);
  });
  it("a different deep-linked ticket is not read until the operator explicitly discards the first draft", async () => {
    const f = await fixture(); await enter("Do not replace draft A");
    await hashGesture(() => { window.location.hash = listHash + "&ticketId=ticket-b"; });
    expect(f.requests.some(value => value.path.endsWith("/conversations/ticket-b"))).toBe(false);
    expect(document.body.textContent).toContain("History ticket-a"); expect(document.body.textContent).toContain("Descartar e fechar");
    await click("Descartar e fechar"); await settledAt(listHash + "&ticketId=ticket-b", "History ticket-b");
    expect(document.body.textContent).toContain("History ticket-b"); expect(document.body.textContent).not.toContain("History ticket-a");
    expect(document.querySelector("textarea")!.value).toBe(""); noMessagesSubmitted(f.requests);
  });
  it("cancelled Back keeps the draft, confirmed Back closes it, and Forward restores only the canonical history", async () => {
    const f = await fixture({ list: true });
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent?.trim() === "Abrir conversa")!.click());
    await settledAt(detailHash, "History ticket-a");
    await enter("Draft while navigating"); await hashGesture(() => window.history.back());
    await settledAt(detailHash, "Continuar editando");
    expect(document.body.textContent).toContain("Continuar editando"); await click("Continuar editando");
    expect(window.location.hash).toBe(detailHash); expect(document.querySelector("textarea")!.value).toBe("Draft while navigating");
    await hashGesture(() => window.history.back()); await settledAt(detailHash, "Descartar e fechar");
    await click("Descartar e fechar"); await settledAt(listHash, "Buyer ticket-a");
    expect(window.location.hash).toBe(listHash); expect(document.querySelector('[role="dialog"]')).toBeNull();
    await hashGesture(() => window.history.forward()); await settledAt(detailHash, "History ticket-a"); expect(window.location.hash).toBe(detailHash);
    expect(document.body.textContent).toContain("History ticket-a"); expect(document.querySelector("textarea")!.value).toBe(""); noMessagesSubmitted(f.requests);
  });
  it("an external route cannot unmount the composer before its explicit discard confirmation", async () => {
    const f = await fixture(); await enter("Keep this before leaving");
    await hashGesture(() => { window.location.hash = "#overview"; });
    await settledAt(detailHash, "Continuar editando");
    expect(document.body.textContent).toContain("History ticket-a"); expect(document.body.textContent).toContain("Continuar editando");
    await click("Continuar editando"); expect(document.querySelector("textarea")!.value).toBe("Keep this before leaving");
    expect(window.location.hash).toBe(detailHash); noMessagesSubmitted(f.requests);
  });
  it("the real Owner Shell sidebar cannot publish its next page before confirming the conversation draft", async () => {
    const f = await fixture({ owner: true }); await enter("Owner draft");
    const sidebar = document.querySelector('nav[aria-label="M\u00f3dulos do painel"]')!;
    const overview = Array.from(sidebar.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent?.includes("Vis\u00e3o Geral"))!;
    await act(async () => overview.click());
    expect(document.body.textContent).toContain("Continuar editando"); expect(document.body.textContent).toContain("History ticket-a");
    expect(document.querySelector('[data-dashboard-page="whatsapp-seller"]')).not.toBeNull();
    await click("Continuar editando"); expect(document.querySelector("textarea")!.value).toBe("Owner draft");
    await act(async () => overview.click()); await click("Descartar e fechar");
    await settledAt("#overview", "Overview page");
    await act(async () => vi.dynamicImportSettled()); expect(document.body.textContent).toContain("Overview page");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); noMessagesSubmitted(f.requests);
  });
  it("logout clears a dirty conversation immediately instead of letting a navigation guard retain its private data", async () => {
    const f = await fixture(); await enter("Private draft before logout"); await click("Sair");
    expect(document.body.textContent).toContain("Login screen"); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("History ticket-a"); expect(document.body.textContent).not.toContain("Private draft before logout");
    expect(f.requests.some(value => value.method === "POST" && value.path.endsWith("/auth/logout"))).toBe(true); noMessagesSubmitted(f.requests);
  });
  it("session expiry clears an open discard confirmation and its draft without resuming its pending destination", async () => {
    const f = await fixture(); await enter("Private expired draft");
    await hashGesture(() => { window.location.hash = listHash; }); await settledAt(detailHash, "Descartar e fechar"); expect(document.body.textContent).toContain("Descartar e fechar");
    await act(async () => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)));
    expect(document.body.textContent).toContain("Login screen"); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("History ticket-a"); expect(document.body.textContent).not.toContain("Private expired draft"); noMessagesSubmitted(f.requests);
  });
  it("X and Escape each discard through the integrated router once, close the drawer and remove ticketId", async () => {
    const f = await fixture();
    for (const gesture of ["X", "Escape"] as const) {
      await enter("Draft to discard through " + gesture);
      await act(async () => {
        if (gesture === "X") document.querySelector<HTMLButtonElement>('[aria-label="Fechar"]')!.click();
        else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(document.body.textContent).toContain("Descartar e fechar");
      expect(window.location.hash).toBe(detailHash); expect(document.body.textContent).toContain("History ticket-a");
      await click("Descartar e fechar"); await settledAt(listHash, "Buyer ticket-a");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.body.textContent).not.toContain("Descartar e fechar"); noMessagesSubmitted(f.requests);
      if (gesture === "X") {
        await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(value => value.textContent?.trim() === "Abrir conversa")!.click());
        await settledAt(detailHash, "History ticket-a"); expect(document.querySelector("textarea")!.value).toBe("");
      }
    }
  });
});
