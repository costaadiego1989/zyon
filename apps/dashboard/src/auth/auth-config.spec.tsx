import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOAuthAuthorizationUrl, generateOAuthProofKey, isAuthCaptchaReady, requiresAuthCaptcha, readOAuthCallback } from "./auth-config.js";
import { AuthScreen } from "./AuthScreen.js";
import { Turnstile } from "./Turnstile.js";

afterEach(() => vi.unstubAllEnvs());
const origin = "https://dashboard.example.test";
const options = { clientId: "synthetic.apps.googleusercontent.com", origin, state: "synthetic-local-state", codeChallenge: "a".repeat(43) };
describe("merchant auth configuration", () => {
  it.each([undefined, "", "   ", "undefined", "null"])("refuses missing OAuth client %s instead of emitting a broken provider URL", clientId => {
    expect(() => buildOAuthAuthorizationUrl("google", { ...options, clientId })).toThrow(/Google/);
  });
  it("builds provider URLs with the current origin callback and unchanged state", () => {
    const hosts = { google: "accounts.google.com", microsoft: "login.microsoftonline.com", facebook: "www.facebook.com", github: "github.com" };
    for (const provider of ["google", "microsoft", "facebook", "github"] as const) {
      const url = new URL(buildOAuthAuthorizationUrl(provider, options));
      expect(url.searchParams.get("client_id")).toBe(options.clientId);
      expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/auth/oauth/callback`);
      expect(url.searchParams.get("state")).toBe(options.state);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe(hosts[provider]);
      expect(url.searchParams.has("client_secret")).toBe(false);
      if (provider !== "github") expect(url.searchParams.get("response_type")).toBe("code");
    }
  });
  it("requests only identity scopes for Microsoft and Facebook", () => {
    const microsoft = new URL(buildOAuthAuthorizationUrl("microsoft", options));
    expect(microsoft.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(microsoft.searchParams.get("scope")).toBe("openid profile email");
    expect(microsoft.searchParams.get("response_mode")).toBe("query");
    const facebook = new URL(buildOAuthAuthorizationUrl("facebook", options));
    expect(facebook.searchParams.get("scope")).toBe("public_profile,email");
    expect(() => buildOAuthAuthorizationUrl("facebook", { ...options, facebookVersion: "https://unsafe.test" })).toThrow();
  });
  it.each(["google", "microsoft", "facebook", "github"] as const)("binds %s callbacks to the browser's provider and state", provider => {
    const codeVerifier = provider === "microsoft" ? "a".repeat(43) : undefined;
    expect(readOAuthCallback("?code=one-use-code&state=expected", "expected", provider, codeVerifier)).toEqual({ code: "one-use-code", state: "expected", provider, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) });
    expect(() => readOAuthCallback("?code=code&state=other", "expected", provider)).toThrow();
    expect(() => readOAuthCallback("?code=code&state=expected&provider=attacker", "expected", provider)).toThrow();
  });
  it("generates a fresh S256 proof and keeps the verifier out of authorization URLs", async () => {
    const proof = await generateOAuthProofKey();
    const second = await generateOAuthProofKey();
    expect(proof.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.codeVerifier).not.toBe(proof.codeVerifier);
    const expected = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof.codeVerifier))).toString("base64url");
    expect(proof.codeChallenge).toBe(expected);
    const url = new URL(buildOAuthAuthorizationUrl("microsoft", { ...options, codeChallenge: proof.codeChallenge }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(expected);
    expect(url.href).not.toContain(proof.codeVerifier);
    expect(() => readOAuthCallback("?code=code&state=expected", "expected", "microsoft")).toThrow();
    expect(() => buildOAuthAuthorizationUrl("microsoft", { ...options, codeChallenge: undefined })).toThrow();
    const google = new URL(buildOAuthAuthorizationUrl("google", options));
    expect(google.searchParams.has("access_type")).toBe(false);
    expect(google.searchParams.get("prompt")).toBe("select_account");
  });
  it("rejects cancelled, incomplete and unsupported callbacks before sending to the API", () => {
    for (const [search, state, provider] of [
      ["?error=access_denied", "state", "facebook"], ["?code=code", "state", "microsoft"],
      ["?code=code&state=state", null, "google"], ["?code=code&state=state", "state", "__proto__"],
    ]) expect(() => readOAuthCallback(search!, state ?? null, provider ?? null)).toThrow();
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
  it.each(["login", "signup"] as const)("offers the same three providers on %s without GitHub", mode => {
    const noop = () => {};
    const html = renderToStaticMarkup(<AuthScreen mode={mode} setMode={noop} busy={false} hint={null}
      email="" setEmail={noop} password="" setPassword={noop} merchantName="" setMerchantName={noop}
      onSubmit={noop} onRegister={async () => {}} onSaveTheme={async () => {}}
      onComplete={async () => {}} turnstileSiteKey="" captchaToken={null} setCaptchaToken={noop} />);
    for (const label of ["Continuar com Google", "Entrar com Microsoft", "Continuar com Facebook"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain("GitHub");
  });
});
