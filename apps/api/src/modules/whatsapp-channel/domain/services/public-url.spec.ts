import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublicApiBaseUrl, twilioWhatsAppCallbackUrl, twilioOperatorStatusCallbackUrl, twilioOperatorStatusRequestUrl } from "./public-url.js";

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

test("HUM05 operator status URL contains only encoded public selectors and rejects missing or credential-bearing bases", () => {
  assert.equal(twilioOperatorStatusCallbackUrl("config/one", "support_message:message", { API_PUBLIC_URL: "https://api.zyon.com.br" }),
    "https://api.zyon.com.br/v1/webhooks/whatsapp/twilio/status?configId=config%2Fone&correlationId=support_message%3Amessage");
  for (const base of [undefined, "https://api.aacp.com", "https://credential@example.test", "https://example.test?query=bad", "https://example.test#fragment"])
    assert.equal(twilioOperatorStatusCallbackUrl("config", "support_message:message", { API_PUBLIC_URL: base }), null);
  assert.equal(twilioOperatorStatusCallbackUrl("config", "order_notification:other", { API_PUBLIC_URL: "https://example.test" }), null);
});

test("HUM05 status signatures retain original encoded query bytes and canonical external prefix", () => {
  const original = "/v1/webhooks/whatsapp/twilio/status?configId=config%2fone&correlationId=support_message%3amessage";
  assert.equal(twilioOperatorStatusRequestUrl(original, { API_PUBLIC_URL: "https://public.example.test/external" }), "https://public.example.test/external" + original);
  assert.equal(twilioOperatorStatusRequestUrl(original, {}), null);
  assert.equal(twilioOperatorStatusRequestUrl("//attacker.example.test/status", { API_PUBLIC_URL: "https://public.example.test" }), null);
  assert.equal(twilioOperatorStatusRequestUrl(original + "#fragment", { API_PUBLIC_URL: "https://public.example.test" }), null);
});
