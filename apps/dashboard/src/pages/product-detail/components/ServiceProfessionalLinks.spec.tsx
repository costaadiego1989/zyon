/** @vitest-environment jsdom */
// UNEXECUTED cache candidate. Productive adoption follows T105 Full/commit.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MerchantProfile } from "../../../api-client.js";
import type { ServiceProfessionalDTO, ServiceProfessionalPage } from "../../../api/endpoints/service-attendance.js";
import { DashboardHttpError } from "../../../api/http/error.js";
import { ApiContext, type DashboardApi } from "../../../hooks/useApi.js";
import { ServiceProfessionalLinks } from "./ServiceProfessionalLinks.js";
import type { ServiceProfessionalLinksOptions } from "../hooks/useServiceProfessionalLinks.js";

const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const { root, host } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
const me: MerchantProfile = { id: "merchant-a", user_id: "owner-a", name: "Empresa local", role: "OWNER", businessMode: "services", businessModeSelectionState: "selected" };
const options: ServiceProfessionalLinksOptions = { me, productId: "target-service", businessMode: "services", productType: "service", blocked: false };
const professional = (productIds: string[] = [], version = 3, extra: Partial<ServiceProfessionalDTO> = {}): ServiceProfessionalDTO => ({
  id: "professional-a", merchantId: me.id, publicName: "Ana Ferreira", publicProfile: {}, timeZone: "America/Sao_Paulo",
  isActive: true, isPublished: false, version, createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z",
  services: productIds.map((productId, index) => ({ id: `link-${index}`, productId, version: 1 })), ...extra,
});
const page = (items: ServiceProfessionalDTO[]): ServiceProfessionalPage => ({ items, nextCursor: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
async function fixture(records: ServiceProfessionalDTO[] = [], props: ServiceProfessionalLinksOptions = options, initialRead?: Promise<ServiceProfessionalPage>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = {
    listProfessionals: vi.fn().mockResolvedValue(page(records)),
    updateProfessional: vi.fn().mockImplementation(async (_id: string, input: { productIds: string[]; expectedVersion: number }) => professional(input.productIds, input.expectedVersion + 1)),
  };
  if (initialRead) client.listProfessionals.mockImplementationOnce(() => initialRead);
  const binding = vi.fn().mockReturnValue(client);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(<ApiContext.Provider value={{ serviceAttendance: binding } as unknown as DashboardApi}><ServiceProfessionalLinks {...props} /></ApiContext.Provider>));
  return { host, client, binding };
}
function button(host: HTMLElement, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === text);
  expect(result, text).toBeTruthy(); return result!;
}
function toggle(host: HTMLElement) {
  const label = Array.from(host.querySelectorAll<HTMLLabelElement>("label[for]")).find(node => node.textContent === "Vincular Ana Ferreira");
  expect(label).toBeTruthy(); const control = document.getElementById(label!.htmlFor) as HTMLButtonElement;
  expect(host.contains(control)).toBe(true); expect(control.getAttribute("role")).toBe("switch"); expect(control.type).toBe("button");
  return { label: label!, control };
}
async function click(control: HTMLElement) { await act(async () => control.click()); }

describe("CAT-04 saved-service professional switches", () => {
  it("explains save-first without a professional request for a draft", async () => {
    const f = await fixture([], { ...options, productId: null });
    expect(f.host.textContent).toContain("Salve o serviço para vincular profissionais.");
    expect(f.binding).not.toHaveBeenCalled(); expect(f.client.listProfessionals).not.toHaveBeenCalled(); expect(f.host.querySelector('[role="switch"]')).toBeNull();
  });

  it("does not mount the controls or bind the SDK in product mode", async () => {
    const f = await fixture([], { ...options, me: { ...me, businessMode: "products" }, businessMode: "products", productType: "physical" });
    expect(f.host.textContent).toBe(""); expect(f.binding).not.toHaveBeenCalled(); expect(f.client.updateProfessional).not.toHaveBeenCalled();
  });

  it("shows the existing management requirement and does not request associations for Staff", async () => {
    const f = await fixture([], { ...options, me: { ...me, role: "STAFF" } });
    expect(f.host.textContent).toContain("Somente o proprietário ou um administrador");
    expect(f.binding).not.toHaveBeenCalled(); expect(f.host.querySelector('[role="switch"]')).toBeNull();
  });

  it("shows loading then the true empty state without inventing professionals", async () => {
    const held = deferred<ServiceProfessionalPage>(), f = await fixture([], options, held.promise);
    expect(f.host.querySelector('section')?.getAttribute("aria-busy")).toBe("true"); expect(f.host.textContent).toContain("Carregando profissionais e vínculos salvos");
    await act(async () => held.resolve(page([])));
    expect(f.host.textContent).toContain("Nenhum profissional cadastrado nesta empresa.");
    expect(button(f.host, "Salvar vínculos").disabled).toBe(true); expect(f.client.updateProfessional).not.toHaveBeenCalled();
  });

  it("reports a read failure and reloads only after the operator's actual gesture", async () => {
    const f = await fixture([]); f.client.listProfessionals.mockRejectedValueOnce(new DashboardHttpError(500, "read-failed"));
    await click(button(f.host, "Recarregar profissionais"));
    expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível carregar os profissionais.");
    expect(button(f.host, "Salvar vínculos").disabled).toBe(true);
    f.client.listProfessionals.mockResolvedValueOnce(page([professional()])); await click(button(f.host, "Recarregar profissionais"));
    expect(toggle(f.host).control.getAttribute("aria-checked")).toBe("false"); expect(f.client.updateProfessional).not.toHaveBeenCalled();
  });

  it("links through the named switch and explicit Save, preserving other IDs and publication", async () => {
    const f = await fixture([professional(["other-service"], 3)]), control = toggle(f.host);
    expect(control.control.getAttribute("aria-checked")).toBe("false"); await click(control.label);
    expect(control.control.getAttribute("aria-checked")).toBe("true"); expect(f.host.textContent).toContain("Alteração ainda não salva");
    expect(f.client.updateProfessional).not.toHaveBeenCalled(); await click(button(f.host, "Salvar vínculos"));
    expect(f.binding).toHaveBeenCalledExactlyOnceWith(me);
    expect(f.client.updateProfessional).toHaveBeenCalledExactlyOnceWith("professional-a", { expectedVersion: 3, productIds: ["other-service", "target-service"] });
    expect(f.host.textContent).toContain("Vínculo salvo."); expect(f.host.textContent).toContain("Vinculado a este serviço"); expect(f.host.textContent).toContain("Não publicado");
    expect(button(f.host, "Salvar vínculos").disabled).toBe(true);
  });

  it("unlinks the same target with a switch gesture and preserves the other service", async () => {
    const f = await fixture([professional(["other-service", "target-service"], 8)]), control = toggle(f.host);
    expect(control.control.getAttribute("aria-checked")).toBe("true"); await click(control.control); await click(button(f.host, "Salvar vínculos"));
    expect(f.client.updateProfessional).toHaveBeenCalledExactlyOnceWith("professional-a", { expectedVersion: 8, productIds: ["other-service"] });
    expect(control.control.getAttribute("aria-checked")).toBe("false"); expect(f.host.textContent).toContain("Sem vínculo com este serviço");
  });

  it("keeps inactive professionals visible but their switch cannot stage a mutation", async () => {
    const f = await fixture([professional(["target-service"], 4, { isActive: false })]), control = toggle(f.host);
    expect(f.host.textContent).toContain("Inativo"); expect(control.control.disabled).toBe(true); expect(control.control.getAttribute("aria-checked")).toBe("true");
    await click(control.label); expect(control.control.getAttribute("aria-checked")).toBe("true");
    expect(button(f.host, "Salvar vínculos").disabled).toBe(true); expect(f.client.updateProfessional).not.toHaveBeenCalled();
  });

  it("requires actual reload and explicit Save after a conflict, using the refreshed full set", async () => {
    const f = await fixture([professional(["old-other"], 3)]); await click(toggle(f.host).control);
    f.client.updateProfessional.mockRejectedValueOnce(new DashboardHttpError(409, "service_professional_stale"));
    await click(button(f.host, "Salvar vínculos"));
    expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("Este profissional mudou."); expect(button(f.host, "Salvar vínculos").disabled).toBe(true);
    f.client.listProfessionals.mockResolvedValueOnce(page([professional(["new-other"], 4)])); await click(button(f.host, "Recarregar profissionais"));
    expect(toggle(f.host).control.getAttribute("aria-checked")).toBe("true"); expect(f.client.updateProfessional).toHaveBeenCalledTimes(1);
    await click(button(f.host, "Salvar vínculos"));
    expect(f.client.updateProfessional).toHaveBeenLastCalledWith("professional-a", { expectedVersion: 4, productIds: ["new-other", "target-service"] });
    expect(f.host.textContent).toContain("Vínculo salvo."); expect(f.client.updateProfessional).toHaveBeenCalledTimes(2);
  });

  it("disables the same switches and both actions while a CAS write is unresolved", async () => {
    const f = await fixture([professional()]), held = deferred<ServiceProfessionalDTO>(); await click(toggle(f.host).control);
    f.client.updateProfessional.mockImplementationOnce(() => held.promise); await click(button(f.host, "Salvar vínculos"));
    expect(toggle(f.host).control.disabled).toBe(true); expect(button(f.host, "Recarregar profissionais").disabled).toBe(true); expect(f.host.textContent).toContain("Salvando vínculo");
    await click(button(f.host, "Recarregar profissionais")); expect(f.client.listProfessionals).toHaveBeenCalledTimes(1);
    await act(async () => held.resolve(professional(["target-service"], 4)));
    expect(f.host.textContent).toContain("Vínculo salvo."); expect(toggle(f.host).control.disabled).toBe(false); expect(f.client.updateProfessional).toHaveBeenCalledTimes(1);
  });
});
