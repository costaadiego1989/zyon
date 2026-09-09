import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchEmbeddedSignup, parseEmbeddedSignupEvent } from "./embedded-signup.js";

const settings = { configured: true, appId: "123456", configId: "234567" };
const finish = { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "123456789", phone_number_id: "987654321" } };

describe("Embedded Signup authorization", () => {
  let events: EventTarget;
  let login: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    events = new EventTarget();
    login = vi.fn();
    vi.stubGlobal("window", { FB: { login }, addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events), setTimeout, clearTimeout });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  function message(data = finish, origin = "https://www.facebook.com") {
    const event = new Event("message");
    Object.assign(event, { origin, data: JSON.stringify(data) });
    events.dispatchEvent(event);
  }
  it.each(["https://evilfacebook.com", "https://facebook.com.evil.test", "http://www.facebook.com", "null", "https://www.facebook.com:444"])("rejects untrusted origin %s", origin => {
    expect(parseEmbeddedSignupEvent({ origin, data: finish })).toBeNull();
  });
  it("validates payload and tolerates unrelated SDK messages", () => {
    expect(parseEmbeddedSignupEvent({ origin: "https://www.facebook.com", data: "not json" })).toBeNull();
    expect(parseEmbeddedSignupEvent({ origin: "https://www.facebook.com", data: { ...finish, data: { waba_id: {} } } })).toBeNull();
    expect(parseEmbeddedSignupEvent({ origin: "https://www.facebook.com", data: finish })).toEqual({ type: "finish", result: { wabaId: "123456789", phoneNumberId: "987654321" } });
  });
  it.each(["finish-first", "code-first"])("joins the independent messages: %s", async order => {
    const controller = new AbortController();
    const result = launchEmbeddedSignup(settings, controller.signal);
    const callback = login.mock.calls[0][0];
    expect(login.mock.calls[0][1]).toEqual({
      config_id: settings.configId,
      auth_type: "rerequest",
      response_type: "code",
      override_default_response_type: true,
    });
    expect(login.mock.calls[0][1]).not.toHaveProperty("extras");
    if (order === "finish-first") message();
    callback({ authResponse: { code: "oauth-code" } });
    if (order === "code-first") message();
    await expect(result).resolves.toEqual({ code: "oauth-code", wabaId: "123456789", phoneNumberId: "987654321" });
    message(); // A late duplicate must not submit again.
    controller.abort();
  });
  it("cleans up cancellation and ignores late results", async () => {
    const controller = new AbortController();
    const result = launchEmbeddedSignup(settings, controller.signal);
    controller.abort();
    message();
    await expect(result).rejects.toThrow("cancelada");
  });
  it("reports provider cancellation without exposing provider data", async () => {
    const result = launchEmbeddedSignup(settings, new AbortController().signal);
    message({ ...finish, event: "CANCEL" });
    await expect(result).rejects.toThrow("Seus dados foram preservados");
  });
});
