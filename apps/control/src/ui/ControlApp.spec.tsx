import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ControlApp } from "./ControlApp.js";
import { PlatformApi, PlatformApiError } from "../lib/api.js";
import { writePlatformSession } from "../lib/session.js";
import { show } from "./prospecting/screen-test.js";

const admin = {
  operator_id: "admin",
  email: "admin@example.test",
  role: "platform_admin" as const,
};
const config = {
  moduleEnabled: true,
  workersRunning: false,
  dispatchMode: "disabled",
  modelMode: "disabled",
  ingestionEnabled: false,
  reservationDayTimezone: "UTC",
} as const;
afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});
function session(user = admin) {
  writePlatformSession({ token: "local-session", operator: user });
  vi.spyOn(PlatformApi.prototype, "me").mockResolvedValue(user);
  vi.spyOn(PlatformApi.prototype, "getOverview").mockRejectedValue(
    new Error("offline")
  );
  vi.spyOn(PlatformApi.prototype, "listOperators").mockRejectedValue(
    new Error("offline")
  );
}
it("PROS-01 AC3 abre pelo menu autorizado e monta a política real sem perder a sessão do Control", async () => {
  session();
  const configRead = vi.fn().mockResolvedValue(config);
  vi.spyOn(PlatformApi.prototype, "prospectingClient").mockReturnValue({
    config: configRead,
    campaigns: async () => ({ items: [] }),
    metrics: async () => {
      throw Error("offline");
    },
    readiness: async () => {
      throw Error("offline");
    },
    privacy: async () => ({ retentionDays: 180, preservedSuppressions: 13 }),
  } as never);
  const ui = await show(<ControlApp />);
  await ui.click("Prospecção");
  await act(async () =>
    ui.host
      .querySelector<HTMLAnchorElement>('a[href="#prospecting/privacy"]')!
      .click()
  );
  expect(ui.text()).toContain("Supressões preservadas13");
  expect(configRead).toHaveBeenCalledTimes(1);
  await ui.click("Visão geral");
  expect(ui.text()).not.toContain("Supressões preservadas");
  expect(sessionStorage.length).toBeGreaterThan(0);
});
it("recupera um link direto e expira a sessão em 401", async () => {
  history.replaceState(null, "", "/#prospecting/privacy");
  session();
  vi.spyOn(PlatformApi.prototype, "prospectingClient").mockReturnValue({
    config: async () => {
      throw new PlatformApiError(401);
    },
  } as never);
  const ui = await show(<ControlApp />);
  expect(ui.text()).toContain("Sua sessão expirou");
  expect(sessionStorage.getItem("zyon.platform-control.session.v1")).toBeNull();
});
it("oculta prospecção de perfis sem direito inclusive por link direto", async () => {
  history.replaceState(null, "", "/#prospecting/leads");
  const user = { ...admin, role: "billing_ops" as const };
  writePlatformSession({ token: "billing-session", operator: user });
  vi.spyOn(PlatformApi.prototype, "me").mockResolvedValue(user);
  vi.spyOn(PlatformApi.prototype, "getOverview").mockRejectedValue(
    Error("offline")
  );
  const client = vi.spyOn(PlatformApi.prototype, "prospectingClient");
  const ui = await show(<ControlApp />);
  expect(ui.text()).not.toContain("Prospecção");
  expect(client).not.toHaveBeenCalled();
});
