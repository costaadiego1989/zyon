import { describe, expect, it } from "vitest";
import { erpConnectionFeedback, erpErrorMessage } from "./erp-connection-feedback.js";

describe("merchant ERP connection recovery", () => {
  it("shows reconnect instead of a healthy state for a rejected Bling authorization", () => {
    const state = erpConnectionFeedback({ status: "connected", lastErrorCode: "erp_bling_app_changed" });
    expect(state.label).toBe("Reconexão necessária"); expect(state.canSync).toBe(false); expect(state.message).toContain("Reconecte sua conta Bling");
  });
  it("keeps an Omie cooldown distinct from invalid keys", () => {
    const state = erpConnectionFeedback({ status: "connected", lastErrorCode: "erp_omie_temporarily_blocked", retryAfterAt: new Date(Date.now() + 1_800_000).toISOString() });
    expect(state.paused).toBe(true); expect(state.requiresReconnect).toBe(false); expect(state.canSync).toBe(false); expect(state.label).toBe("Aguardando provedor");
  });
  it("shows a safe inline credential rejection without echoing the supplied secret", () => {
    const message = erpErrorMessage({ responseBody: JSON.stringify({ message: "erp_omie_credentials_invalid_or_app_suspended" }) });
    expect(message).toContain("App Key e a App Secret");
    expect(erpErrorMessage({ responseBody: JSON.stringify({ message: "raw-provider-secret" }) })).not.toContain("raw-provider-secret");
  });
  it("directs a central Bling application problem to support", () => {
    const state = erpConnectionFeedback({ status: "error", lastErrorCode: "erp_bling_app_configuration_invalid" });
    expect(state.supportRequired).toBe(true); expect(state.message).toContain("suporte da Zyon");
  });
});
