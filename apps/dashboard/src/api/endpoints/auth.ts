import { dashboardJson } from "../http/client.js";
import type { DashboardLoginAuth, DashboardRegisterPayload } from "../types.js";

export function authEndpoints(base: string, f: typeof fetch) {
  return {
    login(email: string, password: string, turnstileToken?: string): Promise<DashboardLoginAuth> {
      return dashboardJson<DashboardLoginAuth>(
        base,
        "/auth/login",
        { method: "POST", jsonBody: { email, password, turnstile_token: turnstileToken } },
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

    oauthCallback(payload: { provider: string; code: string; state: string }): Promise<DashboardLoginAuth> {
      return dashboardJson<DashboardLoginAuth>(
        base,
        "/auth/oauth/callback",
        { method: "POST", jsonBody: payload },
        f
      );
    },

    logout(): Promise<Record<string, never>> {
      return dashboardJson<Record<string, never>>(base, "/auth/logout", { method: "POST" }, f);
    },

    forgotPassword(email: string): Promise<{ ok: true }> {
      return dashboardJson(base, "/auth/forgot-password", { method: "POST", jsonBody: { email } }, f);
    },

    resetPassword(token: string, password: string): Promise<{ ok: true }> {
      return dashboardJson(base, "/auth/reset-password", { method: "POST", jsonBody: { token, password } }, f);
    },

    getMe(): Promise<{ name?: string; merchant_name?: string; email?: string; phone?: string }> {
      return dashboardJson(base, "/auth/me", { method: "GET" }, f);
    },

    updateMe(payload: { name: string; email?: string; phone?: string }): Promise<{ name?: string; phone?: string }> {
      return dashboardJson(base, "/auth/me", { method: "PUT", jsonBody: payload }, f);
    },

    changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true }> {
      return dashboardJson(base, "/auth/me/password", { method: "PUT", jsonBody: { current_password: currentPassword, new_password: newPassword } }, f);
    },

    requestEmailChange(newEmail: string): Promise<{ sent: true; delivered_to: string }> {
      return dashboardJson(base, "/auth/me/email-change/request", { method: "POST", jsonBody: { new_email: newEmail } }, f);
    },

    confirmEmailChange(newEmail: string, code: string): Promise<{ email: string }> {
      return dashboardJson(base, "/auth/me/email-change/confirm", { method: "POST", jsonBody: { new_email: newEmail, code } }, f);
    },
  };
}
