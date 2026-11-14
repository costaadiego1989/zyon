// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it, expect, vi } from "vitest";
import { ApiContext } from "../../hooks/useApi.js";
import { useDeliveryPage } from "./useDeliveryPage.js";
import { useStepShipping } from "../onboarding-wizard/hooks/useStepShipping.js";

vi.mock("../../components/Toast.js", () => ({ showToast: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); });

async function mount(melhorEnvioEnabled: boolean, ownEnabled: boolean) {
  const config = { melhorEnvioEnabled, melhorEnvioConnected: true, melhorEnvioExpiresAt: null, originZip: "01001000",
    ownDelivery: { enabled: ownEnabled, mode: "fixed" as const, flatPriceCents: 800, freeAboveCents: null,
      estimatedValue: 60, estimatedUnit: "minutes" as const, neighborhoods: [], radiusZones: [] } };
  const api = { getDeliveryConfig: vi.fn(async () => config), updateDeliveryConfig: vi.fn(async (_payload: Record<string, unknown>) => ({ success: true })),
    getShipments: vi.fn(async () => ({ items: [], total: 0 })) };
  let vm!: ReturnType<typeof useDeliveryPage>;
  function Harness() { vm = useDeliveryPage(); return null; }
  const root = createRoot(document.createElement("div")); roots.push(root);
  await act(async () => root.render(<ApiContext.Provider value={api as never}><Harness /></ApiContext.Provider>));
  return { api, read: () => vm };
}

it("activating Melhor Envio preserves enabled local delivery in the request and UI", async () => {
  const h = await mount(false, true);
  await act(async () => h.read().toggleMelhorEnvio(true));
  expect(h.api.updateDeliveryConfig).toHaveBeenCalledWith({ melhorEnvioEnabled: true });
  expect(h.read().config.ownDelivery.enabled).toBe(true);
  expect(h.read().config.melhorEnvioEnabled).toBe(true);
});

it("saving local delivery preserves Melhor Envio and saves the shared origin CEP", async () => {
  const h = await mount(true, false);
  await act(async () => h.read().saveOwnDeliveryConfig({ flatPriceCents: 1200 }, "01002000"));
  expect(h.api.updateDeliveryConfig.mock.calls[0]?.[0]).toMatchObject({ originZip: "01002000", ownDelivery: { enabled: true, flatPriceCents: 1200 } });
  expect(h.api.updateDeliveryConfig.mock.calls[0]?.[0]).not.toHaveProperty("melhorEnvioEnabled");
  expect(h.read().config.melhorEnvioEnabled).toBe(true);
  expect(h.read().config.ownDelivery.enabled).toBe(true);
});

it("connecting Melhor Envio during onboarding preserves local delivery", async () => {
  const api = { getDeliveryConfig: vi.fn(async () => ({ melhorEnvioEnabled: false, ownDelivery: { enabled: true } })),
    updateDeliveryConfig: vi.fn(async () => ({ success: true })), getMelhorEnvioAuthorizeUrl: vi.fn(() => "#melhor-envio") };
  let vm!: ReturnType<typeof useStepShipping>;
  function Harness() { vm = useStepShipping(); return null; }
  const root = createRoot(document.createElement("div")); roots.push(root);
  await act(async () => root.render(<ApiContext.Provider value={api as never}><Harness /></ApiContext.Provider>));
  await act(async () => vm.connect());
  expect(api.updateDeliveryConfig).toHaveBeenCalledWith({ melhorEnvioEnabled: true });
  expect(vm.config?.ownDelivery.enabled).toBe(true);
});
