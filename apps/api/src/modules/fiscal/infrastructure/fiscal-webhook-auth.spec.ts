import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { authenticateFiscalWebhook } from "./fiscal-webhook-auth.js";
const raw = Buffer.from('{ "event":"invoice.updated", "companyId":"account_original" }'); const secret = "private_hook_secret";
const signature = createHmac("sha256", secret).update(raw).digest("hex");
const bling = (headers: Record<string, unknown> = { "x-bling-signature-256": "sha256=" + signature }, body = raw, key = secret) => authenticateFiscalWebhook({ provider: "bling", rawBody: body, headers, configuration: { secret: key } });
test("FISCAL-37 Bling verifies the documented HMAC of exact raw bytes", () => { assert.deepEqual(bling(), { authenticated: true }); });
test("FISCAL-37 reserialized JSON or byte tampering cannot reuse a valid Bling signature", () => { assert.equal(bling(undefined, Buffer.from(JSON.stringify(JSON.parse(raw.toString())))).authenticated, false); });
test("FISCAL-37 another application secret cannot authenticate the Bling payload", () => { assert.equal(bling(undefined, raw, "another_private_secret").authenticated, false); });
test("FISCAL-37 missing, malformed, coalesced or duplicate HMAC headers are refused", () => {
  for (const value of [undefined, "bad", "sha256=00", "sha256=" + signature + ",sha256=" + signature, ["sha256=" + signature]]) assert.equal(bling({ "x-bling-signature-256": value }).authenticated, false);
  assert.equal(bling({ "x-bling-signature-256": "sha256=" + signature, "X-Bling-Signature-256": "sha256=" + signature }).authenticated, false);
});
test("FISCAL-37 absent or excessive raw body cannot authenticate a fiscal webhook", () => { assert.equal(authenticateFiscalWebhook({ provider: "bling", headers: {}, configuration: { secret } }).authenticated, false); assert.equal(bling(undefined, Buffer.alloc(1024 * 1024 + 1)).authenticated, false); });
test("FISCAL-37 Focus matches the configured literal on the configured case-insensitive header", () => { assert.deepEqual(authenticateFiscalWebhook({ provider: "focus", headers: { "X-Focus-Authorization": "Bearer company_hook_a" }, configuration: { secret: "Bearer company_hook_a", headerName: "x-focus-authorization" } }), { authenticated: true }); });
test("FISCAL-38 Focus another hook token or header name cannot cross a connection", () => {
  for (const headers of [{ authorization: "company_hook_a" }, { "x-hook": "company_hook_b" }, { "x-hook": ["company_hook_a"] }]) assert.equal(authenticateFiscalWebhook({ provider: "focus", headers, configuration: { secret: "company_hook_a", headerName: "x-hook" } }).authenticated, false);
});
test("FISCAL-37 missing Focus configuration and invalid header names remain unconfigured", () => {
  for (const configuration of [undefined, { secret: "company_hook_a" }, { secret: "", headerName: "x-hook" }, { secret: "x", headerName: "x-hook\r\nInjected" }]) assert.equal(authenticateFiscalWebhook({ provider: "focus", headers: { "x-hook": "company_hook_a" }, configuration }).authenticated, false);
});
for (const provider of ["omie", "tiny"] as const) test("FISCAL-37 " + provider + " uses authenticated query fallback without invented HMAC", () => { assert.deepEqual(authenticateFiscalWebhook({ provider, rawBody: raw, headers: { "x-bling-signature-256": "sha256=" + signature }, configuration: { secret } }), { authenticated: false, reasonCode: "fiscal_webhook_query_only" }); });
test("FISCAL-61 webhook auth diagnostics contain only safe reason code without body or secret", () => {
  const result = authenticateFiscalWebhook({ provider: "focus", headers: { authorization: "private_buyer_data" }, configuration: { secret, headerName: "authorization" } }); assert.deepEqual(result, { authenticated: false, reasonCode: "fiscal_webhook_authentication_failed" }); assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(result).includes("private_buyer_data"));
});
