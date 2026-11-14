import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOAuthAuthorizationUrl, isAuthCaptchaReady, requiresAuthCaptcha } from "./auth-config.js";
import { AuthScreen } from "./AuthScreen.js";
import { Turnstile } from "./Turnstile.js";

afterEach(() => vi.unstubAllEnvs());
const origin = "https://dashboard.example.test";
const options = { clientId: "synthetic.apps.googleusercontent.com", origin, state: "synthetic-local-state" };
describe("merchant auth configuration", () => {
  it.each(["", "   ", "undefined", "null", "synthetic-github"])("only presents configured GitHub login/signup: %s", clientId => {
    vi.stubEnv("VITE_GITHUB_CLIENT_ID", clientId);
    const noop = () => {};
    for (const mode of ["login", "signup"] as const) {
      const html = renderToStaticMarkup(<AuthScreen mode={mode} setMode={noop} busy={false} hint={null}
        email="" setEmail={noop} password="" setPassword={noop} merchantName="" setMerchantName={noop}
        onSubmit={noop} onRegister={async () => {}} onSaveTheme={async () => {}}
        onComplete={async () => {}} turnstileSiteKey="site" captchaToken={null} setCaptchaToken={noop} />);
      expect(html.includes('<span>GitHub</span>')).toBe(clientId === "synthetic-github");
      expect(html).toContain('<span>Google</span>');
    }
  });
  it.each([undefined, "", "   ", "undefined", "null"])("refuses missing OAuth client %s instead of emitting a broken provider URL", clientId => {
    expect(() => buildOAuthAuthorizationUrl("google", { ...options, clientId })).toThrow(/Google/);
  });
  it("builds valid Google and GitHub URLs with the current origin callback and unchanged state", () => {
    for (const provider of ["google", "github"] as const) {
      const url = new URL(buildOAuthAuthorizationUrl(provider, options));
      expect(url.searchParams.get("client_id")).toBe(options.clientId);
      expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/auth/oauth/callback`);
      expect(url.searchParams.get("state")).toBe(options.state);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe(provider === "google" ? "accounts.google.com" : "github.com");
    }
  });
  it.each(["https://other.example.test/auth/oauth/callback", "javascript:alert(1)", `${origin}/auth/oauth/callback?token=unsafe`])("refuses invalid callback %s", redirectUri => {
    expect(() => buildOAuthAuthorizationUrl("google", { ...options, redirectUri })).toThrow();
  });
  it("requires configured CAPTCHA in production; whitespace tokens never enable submission", () => {
    expect(requiresAuthCaptcha("", true)).toBe(true);
    expect(isAuthCaptchaReady("", "", true)).toBe(false);
    expect(isAuthCaptchaReady("site", " ", true)).toBe(false);
    expect(isAuthCaptchaReady("site", "synthetic-token", true)).toBe(true);
    expect(isAuthCaptchaReady("", "synthetic-token", true)).toBe(false);
  });
  it("preserves explicit unconfigured local development, while configured local CAPTCHA remains required", () => {
    expect(requiresAuthCaptcha("", false)).toBe(false);
    expect(isAuthCaptchaReady("", null, false)).toBe(true);
    expect(isAuthCaptchaReady("site", null, false)).toBe(false);
  });
  it("shows an unavailable status instead of hiding a required missing-key CAPTCHA", () => {
    const html = renderToStaticMarkup(<Turnstile required siteKey="" onChange={() => { throw Error("no SSR side effect"); }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("verificação de segurança");
  });
  it("does not allow production login to submit while its CAPTCHA configuration is missing", () => {
    vi.stubEnv("PROD", true);
    const noop = () => {};
    const html = renderToStaticMarkup(<AuthScreen mode="login" setMode={noop} busy={false} hint={null}
      email="" setEmail={noop} password="" setPassword={noop} merchantName="" setMerchantName={noop}
      onSubmit={() => { throw Error("no submission"); }} onRegister={async () => {}} onSaveTheme={async () => {}}
      onComplete={async () => {}} turnstileSiteKey="" captchaToken={null} setCaptchaToken={noop} />);
    expect(html).toMatch(/<button\b[^>]*type="submit"[^>]*disabled/);
    expect(html).toContain('role="alert"');
  });
});

