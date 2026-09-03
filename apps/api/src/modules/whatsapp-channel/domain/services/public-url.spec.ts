import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublicApiBaseUrl, twilioWhatsAppCallbackUrl } from "./public-url.js";

test("resolvePublicApiBaseUrl: valid https URL", () => {
  assert.equal(resolvePublicApiBaseUrl({ API_PUBLIC_URL: "https://api.zyon.com.br" } as any), "https://api.zyon.com.br");
});

test("resolvePublicApiBaseUrl: strips trailing slash", () => {
  assert.equal(resolvePublicApiBaseUrl({ API_PUBLIC_URL: "https://api.zyon.com.br/" } as any), "https://api.zyon.com.br");
});

test("resolvePublicApiBaseUrl: localhost http allowed (dev)", () => {
  assert.equal(resolvePublicApiBaseUrl({ API_PUBLIC_URL: "http://localhost:3009" } as any), "http://localhost:3009");
});

test("resolvePublicApiBaseUrl: unset → null", () => {
  assert.equal(resolvePublicApiBaseUrl({} as any), null);
  assert.equal(resolvePublicApiBaseUrl({ API_PUBLIC_URL: "" } as any), null);
  assert.equal(resolvePublicApiBaseUrl({ API_PUBLIC_URL: "   " } as any), null);
});

test("resolvePublicApiBaseUrl: rejects the known-bad placeholder", () => {
  assert.equal(resolvePublicApiBaseUrl({ API_PUBLIC_URL: "https://api.aacp.com" } as any), null);
});

test("resolvePublicApiBaseUrl: rejects malformed / non-http", () => {
  assert.equal(resolvePublicApiBaseUrl({ API_PUBLIC_URL: "not a url" } as any), null);
  assert.equal(resolvePublicApiBaseUrl({ API_PUBLIC_URL: "ftp://x.y" } as any), null);
});

test("twilioWhatsAppCallbackUrl: builds full path when configured", () => {
  assert.equal(
    twilioWhatsAppCallbackUrl({ API_PUBLIC_URL: "https://api.zyon.com.br" } as any),
    "https://api.zyon.com.br/v1/webhooks/whatsapp/twilio"
  );
});

test("twilioWhatsAppCallbackUrl: null when no valid public URL", () => {
  assert.equal(twilioWhatsAppCallbackUrl({} as any), null);
  assert.equal(twilioWhatsAppCallbackUrl({ API_PUBLIC_URL: "https://api.aacp.com" } as any), null);
});
