/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantProfile } from "../../api-client.js";
import { WhatsAppSellerPage } from "./WhatsAppSellerPage.js";
const observed = vi.hoisted(() => ({ config: 0, usage: 0, toggles: [] as boolean[] }));
vi.mock("./useWhatsAppSellerPage.js", () => ({ useWhatsAppSellerPage: () => {
  observed.config++; return { config: { status: "active", enabled: true, whatsappNumber: "5511999999999" }, settings: { configured: true },
    loading: false, saving: false, justConnected: false, connectError: null, handleToggleEnabled: (enabled: boolean) => observed.toggles.push(enabled),
    refresh: () => {}, handleDisconnect: () => {}, load: () => {} };
} }));
vi.mock("./useWhatsAppUsage.js", () => ({ useWhatsAppUsage: () => { observed.usage++; return { data: null, loading: false, error: null }; } }));
vi.mock("./WhatsAppUsageTab.js", async () => { const { createElement: h } = await import("react"); return {
  WhatsAppUsageTab: () => h("p", null, "Consumo existente"), WhatsAppProcessingNotice: () => null };
});
vi.mock("./WhatsAppTemplatesTab.js", async () => { const { createElement: h } = await import("react"); return { WhatsAppTemplatesTab: () => h("p", null, "Modelos existentes") }; });
vi.mock("../../components/PremiumFeatureGate.js", () => ({ PremiumFeatureGate: (props: { children: React.ReactNode }) => props.children }));
vi.mock("./WhatsAppConversationsTab.js", async () => { const { createElement: h } = await import("react"); return { WhatsAppConversationsTab: () => h("p", null, "Fila canônica") }; });
const mounts: Array<{ root: Root; host: HTMLElement }> = [];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); observed.config = 0; observed.usage = 0; observed.toggles.length = 0; });
afterEach(async () => { for (const item of mounts.splice(0)) { await act(async () => item.root.unmount()); item.host.remove(); } });
async function mount(role: "OWNER" | "ADMIN", tab: string, businessMode: "products" | "services" = "products") {
  window.history.replaceState({}, "", "/#whatsapp-seller?tab=" + tab);
  const me = { id: "merchant-a", user_id: "operator-a", name: "Synthetic shop", role, businessMode, businessModeSelectionState: "selected" } as MerchantProfile;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(<WhatsAppSellerPage apiBaseUrl="https://api.example.test" me={me} />));
}
async function tab(name: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(value => value.textContent?.trim() === name)!;
  await act(async () => button.click());
}
describe("T62 WhatsApp mount preserves existing configuration separately from Conversations", () => {
  it("a direct Conversations URL does not start connection or usage effects for the Owner", async () => {
    await mount("OWNER", "conversations"); expect(document.body.textContent).toContain("Fila canônica");
    expect(observed.config).toBe(0); expect(observed.usage).toBe(0);
  });
  it("the current connection toggle remains functional when configuration is selected", async () => {
    await mount("OWNER", "connection");
    const pause = Array.from(document.querySelectorAll("button")).find(value => value.textContent?.trim() === "Pausar canal")!;
    await act(async () => pause.click()); expect(observed.toggles).toEqual([false]);
    expect(document.body.textContent).toContain("WhatsApp Business ativo"); expect(observed.config).toBeGreaterThan(0);
  });
  it("existing templates, orders and usage remain reachable through their actual tab gestures", async () => {
    await mount("OWNER", "connection"); await tab("Modelos de mensagem"); expect(document.body.textContent).toContain("Modelos existentes");
    await tab("Pedidos no WhatsApp"); expect(document.body.textContent).toContain("Transforme conversas");
    await tab("Consumo e cobrança"); expect(document.body.textContent).toContain("Consumo existente");
    expect(new URLSearchParams(window.location.hash.split("?")[1]).get("tab")).toBe("usage");
  });
  it("Admin sees the same Conversations tab in both company modes without starting configuration", async () => {
    for (const businessMode of ["products", "services"] as const) {
      await mount("ADMIN", "conversations", businessMode); expect(document.body.textContent).toContain("Fila canônica");
    }
    expect(observed.config).toBe(0); expect(observed.usage).toBe(0);
  });
});


describe("T62 selected Conversations remains reachable on a narrow tab strip", () => {
  it("reveals the URL-selected tab horizontally without moving focus and preserves keyboard navigation back to it", async () => {
    const nativeRect = HTMLElement.prototype.getBoundingClientRect;
    const nativeWidth = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!.get!;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("role") === "tablist") return new DOMRect(16, 250, 340, 48);
      if (this.getAttribute("role") === "tab") {
        const bar = this.parentElement!;
        const index = Array.from(bar.querySelectorAll('[role="tab"]')).indexOf(this);
        return new DOMRect(16 + index * 180 - bar.scrollLeft, 250, 160, 48);
      }
      return nativeRect.call(this);
    });
    const width = vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
      return this.getAttribute("role") === "tablist" ? 340 : nativeWidth.call(this);
    });
    const assertVisibleSelection = () => {
      const bar = document.querySelector<HTMLElement>('[role="tablist"]')!;
      const selected = bar.querySelector<HTMLButtonElement>('[aria-selected="true"]')!;
      expect(selected.textContent).toBe("Conversas");
      expect(selected.getBoundingClientRect().left).toBeGreaterThanOrEqual(bar.getBoundingClientRect().left);
      expect(selected.getBoundingClientRect().right).toBeLessThanOrEqual(bar.getBoundingClientRect().left + bar.clientWidth);
      expect(bar.scrollLeft).toBeGreaterThan(0);
      return selected;
    };
    try {
      const previousFocus = document.activeElement;
      await mount("ADMIN", "conversations");
      const selected = assertVisibleSelection();
      expect(document.activeElement).toBe(previousFocus);
      expect(observed.config).toBe(0); expect(observed.usage).toBe(0);
      await act(async () => selected.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
      expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Conexão");
      // A URL transition uses the same canonical listener as browser Back.
      await act(async () => {
        window.history.replaceState(window.history.state, "", "/#whatsapp-seller?tab=conversations");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      assertVisibleSelection();
      expect(document.body.textContent).toContain("Fila canônica");
    } finally { rect.mockRestore(); width.mockRestore(); }
  });
});
