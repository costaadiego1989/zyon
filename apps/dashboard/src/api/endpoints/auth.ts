import { dashboardJson } from "../http/client.js";
import type { DashboardLoginAuth, DashboardRegisterPayload } from "../types.js";

export function authEndpoints(base: string, f: typeof fetch) {
  return {
    login(email: string, password: string): Promise<DashboardLoginAuth> {
      return dashboardJson<DashboardLoginAuth>(
        base,
        "/auth/login",
        { method: "POST", jsonBody: { email, password } },
        f
      );
    },

    register(payload: DashboardRegisterPayload): Promise<DashboardLoginAuth> {
      return dashboardJson<DashboardLoginAuth>(
        base,
        "/auth/register",
        { method: "POST", jsonBody: payload },
        f
      );
    },

    logout(): Promise<Record<string, never>> {
      return dashboardJson<Record<string, never>>(base, "/auth/logout", { method: "POST" }, f);
    },
  };
}
