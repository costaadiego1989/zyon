import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { MetaSignupAuthorizationAdapter } from "./meta-signup-authorization.adapter.js";
import { encodeWhatsAppCredentials, decodeWhatsAppCredentials } from "../repositories/whatsapp-credential-codec.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const assets = { accessToken: "test-token", phoneNumberId: "123456789", wabaId: "987654321" };

test("registers the selected Cloud API phone with the stored six-digit PIN", async () => {
  let request: RequestInit | undefined;
  globalThis.fetch = (async (url, init) => {
    assert.equal(String(url), "https://graph.facebook.com/v23.0/123456789/register");
    request = init;
    return Response.json({ success: true });
  }) as typeof fetch;
  await new MetaSignupAuthorizationAdapter().registerPhone(assets, "012345");
  assert.equal(request?.method, "POST");
  assert.equal(new Headers(request?.headers).get("Authorization"), "Bearer test-token");
  assert.deepEqual(JSON.parse(String(request?.body)), { messaging_product: "whatsapp", pin: "012345" });
});

test("registration requires provider success and treats timeout as unknown", async () => {
  const adapter = new MetaSignupAuthorizationAdapter();
  globalThis.fetch = (async () => Response.json({ success: false })) as typeof fetch;
  await assert.rejects(adapter.registerPhone(assets, "012345"), /META_REGISTRATION_UNKNOWN/);
  globalThis.fetch = (async () => { throw new Error("network"); }) as typeof fetch;
  await assert.rejects(adapter.registerPhone(assets, "012345"), /META_REGISTRATION_UNKNOWN/);
  globalThis.fetch = (async () => Response.json({ error: { code: 80008 } }, { status: 400 })) as typeof fetch;
  await assert.rejects(adapter.registerPhone(assets, "012345"), /META_RATE_LIMITED/);
});

test("phone verification alone cannot certify Cloud API registration", async () => {
  const adapter = new MetaSignupAuthorizationAdapter();
  globalThis.fetch = (async () => Response.json({ code_verification_status: "VERIFIED", status: "PENDING", platform_type: "NOT_APPLICABLE" })) as typeof fetch;
  assert.equal(await adapter.isPhoneRegistered(assets), false);
  globalThis.fetch = (async () => Response.json({ status: "CONNECTED", platform_type: "CLOUD_API" })) as typeof fetch;
  assert.equal(await adapter.isPhoneRegistered(assets), true);
});

test("registration PIN is encrypted at rest and round trips through the config codec", () => {
  const previous = process.env.AACP_PII_ENC_KEY;
  process.env.AACP_PII_ENC_KEY = "registration-test-key";
  try {
    const stored = encodeWhatsAppCredentials({ registrationPin: "012345", phoneNumberId: assets.phoneNumberId });
    assert.match(String(stored.registrationPin), /^pii_v1:/);
    assert.equal(stored.phoneNumberId, assets.phoneNumberId);
    assert.equal(decodeWhatsAppCredentials(stored).registrationPin, "012345");
  } finally { if (previous === undefined) delete process.env.AACP_PII_ENC_KEY; else process.env.AACP_PII_ENC_KEY = previous; }
});
