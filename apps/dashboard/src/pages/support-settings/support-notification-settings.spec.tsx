/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboardApi } from "../../api-client.js";
import type { MerchantProfile } from "../../api/types.js";
import { SupportNotificationSettings } from "./support-notification-settings.js";
import { SupportSettingsPage } from "./support-settings-page.js";

vi.mock("../../hooks/useSupportSocket.js", () => ({ useSupportSocket: () => ({ connected: false }) }));
vi.mock("./tabs/SupportTicketsTab.js", () => ({ SupportTicketsTab: () => null }));
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { vi.stubGlobal("crypto", { randomUUID }); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); vi.unstubAllGlobals(); });
const profile = (role: MerchantProfile["role"] = "OWNER", mode: MerchantProfile["businessMode"] = "services", id = "merchant-a", user = "user-a"): MerchantProfile =>
  ({ id, user_id: user, name: "Empresa", role, businessMode: mode });
const input = (label = "WhatsApp da equipe") => {
  const target = Array.from(document.querySelectorAll("label")).find(row => row.textContent === label);
  return target ? document.getElementById(target.htmlFor) as HTMLInputElement : null;
};
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(row => row.textContent?.trim() === label)!;
async function type(value: string, label?: string) {
  const field = input(label)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function click(label: string) { await act(async () => button(label).click()); }
function fixture(initial: string | null = null) {
  let saved = initial, version = 1, error = 0, network = false, deferGet = false, deferPut = false;
  let heldGet: ((response: Response) => void) | undefined, heldPut: ((response: Response) => void) | undefined;
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const response = () => ({ channel: "whatsapp", fallbackPhone: saved, version, updatedAt: "2026-11-20T12:00:00Z" });
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (path.endsWith("/support/notification-settings")) {
      if (network) throw Error("synthetic_private_network_error");
      if (error) return Response.json({ message: "synthetic_private_server_detail" }, { status: error });
      if (method === "GET" && deferGet) { deferGet = false; return new Promise(resolve => { heldGet = resolve; }); }
      if (method === "PUT" && deferPut) { deferPut = false; return new Promise(resolve => { heldPut = resolve; }); }
      if (method === "PUT") { saved = body.fallbackPhone === null ? null : "+" + body.fallbackPhone.replace(/\D/g, ""); version++; }
      return Response.json(response());
    }
    if (path.endsWith("/support/settings")) return Response.json({ faqItems: [{ id: "faq-a", question: "Pergunta salva", answer: "Resposta salva" }], version: 7 });
    if (path.endsWith("/support/tickets")) return Response.json([]);
    throw Error("unexpected_notification_settings_request:" + path);
  };
  return { fetcher, calls, get saved() { return saved; }, fail(status: number) { error = status; }, recover() { error = 0; network = false; }, offline() { network = true; },
    holdGet() { deferGet = true; }, holdPut() { deferPut = true; },
    async releaseGet(phone = "+5511999999999") { await act(async () => { heldGet?.(Response.json({ ...response(), fallbackPhone: phone })); heldGet = undefined; }); },
    async releasePut(phone = "+5511888888888") { await act(async () => { heldPut?.(Response.json({ ...response(), fallbackPhone: phone })); heldPut = undefined; }); } };
}
async function mount(f: ReturnType<typeof fixture>, me: MerchantProfile | null = profile(), page = false) {
  vi.stubGlobal("fetch", f.fetcher);
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: f.fetcher });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = async (current: MerchantProfile | null) => { await act(async () => root.render(page ? <SupportSettingsPage me={current} apiBaseUrl="https://api.example.test" /> : <SupportNotificationSettings api={api} me={current} />)); };
  cleanups.push(async () => { await act(async () => root.unmount()); host.remove(); await f.releaseGet(); await f.releasePut(); });
  await render(me); return { render };
}

describe("T101 private staff notification settings", () => {
  for (const mode of ["products", "services"] as const) for (const role of ["OWNER", "ADMIN"] as const)
    it(`${role}/${mode} loads and saves the canonical private configuration without claiming delivery`, async () => {
      const f = fixture(); await mount(f, profile(role, mode)); expect(input()!.value).toBe("");
      await type("55 (11) 99999-9999"); await click("Salvar telefone");
      expect(input()!.value).toBe("(11) 99999-9999"); expect(document.body.textContent).toContain("Telefone configurado");
      expect(document.body.textContent).not.toMatch(/notificaç[õo]es funcionando|notificaç[õo]es entregues/i);
      expect(f.calls.filter(row => row.method === "PUT")).toEqual([{ path: "/v1/support/notification-settings", method: "PUT", body: { fallbackPhone: "+5511999999999" } }]);
      expect(f.calls.every(row => row.path === "/v1/support/notification-settings")).toBe(true);
    });
  it("clear sends explicit null and reload retains the actual empty configuration", async () => {
    const f = fixture("+5511999999999"), view = await mount(f); await click("Remover telefone");
    expect(f.saved).toBeNull(); expect(input()!.value).toBe(""); expect(document.body.textContent).toContain("Telefone não configurado");
    expect(f.calls.find(row => row.method === "PUT")!.body).toEqual({ fallbackPhone: null });
    await view.render(null); await view.render(profile()); expect(input()!.value).toBe("");
  });
  for (const status of [400, 403, 503]) it(`a ${status} save preserves the editable draft and does not claim success or retry`, async () => {
    const f = fixture(); await mount(f); await type("5511988888888"); f.fail(status); await click("Salvar telefone");
    expect(input()!.value).toBe("(11) 98888-8888"); expect(input()!.disabled).toBe(false); expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("synthetic_private_server_detail"); expect(document.body.textContent).toContain("Telefone não configurado");
    expect(f.calls.filter(row => row.method === "PUT")).toHaveLength(1);
  });
  it("network loss preserves the draft until an explicit successful retry", async () => {
    const f = fixture(); await mount(f); await type("5511988888888"); f.offline(); await click("Salvar telefone");
    expect(input()!.value).toBe("(11) 98888-8888"); expect(f.calls.filter(row => row.method === "PUT")).toHaveLength(1);
    f.recover(); await click("Salvar telefone"); expect(input()!.value).toBe("(11) 98888-8888");
  });
  it("a failed load is visible and reload is an explicit gesture", async () => {
    const f = fixture("+5511999999999"); f.fail(503); await mount(f); expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(f.calls).toHaveLength(1); expect(document.body.textContent).not.toContain("Telefone configurado");
    f.recover(); await click("Tentar novamente"); expect(input()!.value).toBe("(11) 99999-9999");
  });
  for (const role of ["STAFF", undefined] as const) it(`role ${String(role)} cannot fetch or display the private recipient`, async () => {
    const f = fixture("+5511999999999"), me = { ...profile(), role }; await mount(f, me);
    expect(input()).toBeNull(); expect(f.calls).toHaveLength(0); expect(document.body.textContent).not.toContain("5511999999999");
  });
  for (const change of ["merchant", "user", "logout"] as const) it(`a pending read cannot reveal the previous phone after ${change}`, async () => {
    const f = fixture(); f.holdGet(); const view = await mount(f);
    await view.render(change === "logout" ? null : profile("OWNER", "services", change === "merchant" ? "merchant-b" : "merchant-a", "user-b"));
    await f.releaseGet("+5511999999999"); expect(document.body.textContent).not.toContain("5511999999999"); if (input()) expect(input()!.value).toBe("");
  });
  it("a pending save cannot populate another user scope", async () => {
    const f = fixture(), view = await mount(f); await type("5511888888888"); f.holdPut(); await click("Salvar telefone");
    await view.render(profile("OWNER", "services", "merchant-b", "user-b")); await f.releasePut(); expect(input()!.value).toBe("");
  });
  it("editing after a load failure survives a later failed save", async () => {
    const f = fixture(); f.fail(503); await mount(f); await type("5511888888888"); await click("Salvar telefone"); expect(input()!.value).toBe("(11) 88888-8888");
  });
  it("save and clear leave the mounted FAQ editor and its unsaved text intact", async () => {
    const f = fixture(); await mount(f, profile(), true); await click("Perguntas frequentes");
    const field = input("Pergunta do comprador")!; await type("Pergunta ainda não salva", "Pergunta do comprador");
    await type("5511999999999"); await click("Salvar telefone"); await click("Remover telefone");
    expect(input("Pergunta do comprador")).toBe(field); expect(field.value).toBe("Pergunta ainda não salva");
    expect(f.calls.filter(row => row.path === "/v1/support/settings" && row.method === "PUT")).toHaveLength(0);
  });
  for (const [national, formatted, canonical] of [
    ["11999999999", "(11) 99999-9999", "+5511999999999"],
    ["1133334444", "(11) 3333-4444", "+551133334444"],
    ["55999999999", "(55) 99999-9999", "+5555999999999"],
  ]) it(`national input ${national.length} digits/${national.slice(0, 2)} saves E164 and displays DDD without requiring the country code`, async () => {
    const f = fixture(); await mount(f); await type(national);
    expect(input()!.value).toBe(formatted); await click("Salvar telefone");
    expect(f.saved).toBe(canonical); expect(input()!.value).toBe(formatted);
    expect(f.calls.filter(row => row.method === "PUT")).toEqual([{ path: "/v1/support/notification-settings", method: "PUT", body: { fallbackPhone: canonical } }]);
  });
  it("a loaded Brazilian number uses the national field format without creating an unsaved change", async () => {
    const f = fixture("+5511999999999"); await mount(f);
    expect(input()!.value).toBe("(11) 99999-9999"); expect(input()!.autocomplete).toBe("tel-national");
    expect(input()!.placeholder).toBe("(11) 99999-9999"); expect(document.body.textContent).not.toMatch(/\bDDI\b/);
    expect(button("Salvar telefone").disabled).toBe(true); await type("11999999999"); expect(button("Salvar telefone").disabled).toBe(true);
    expect(f.calls.filter(row => row.method === "PUT")).toHaveLength(0);
  });
  it("an existing non-Brazilian number is never truncated, replaced or saved on mount", async () => {
    const f = fixture("+442079460018"); await mount(f);
    expect(input()!.value).toBe("+442079460018"); expect(button("Salvar telefone").disabled).toBe(true);
    expect(f.saved).toBe("+442079460018"); expect(f.calls.filter(row => row.method === "PUT")).toHaveLength(0);
  });
  it("an incomplete national draft remains intact when the canonical API rejects it", async () => {
    const f = fixture(); await mount(f); await type("123"); f.fail(400); await click("Salvar telefone");
    expect(input()!.value).toBe("123"); expect(document.querySelector('[role="alert"]')?.textContent).toContain("Confira o DDD e o número");
    expect(f.calls.filter(row => row.method === "PUT")).toEqual([{ path: "/v1/support/notification-settings", method: "PUT", body: { fallbackPhone: "123" } }]);
    expect(f.saved).toBeNull(); expect(document.body.textContent).toContain("Telefone não configurado");
  });
});
