import assert from "node:assert/strict";
import test from "node:test";
import { CreateMercadoPagoOAuthLinkUseCase, HandleMercadoPagoOAuthCallbackUseCase, readMercadoPagoOAuthState } from "./mercadopago-platform.use-cases.js";
import { InMemoryPaymentPlatformRepository } from "../infrastructure/in-memory-payment-platform.repository.js";
import { encryptPaymentSecret } from "../infrastructure/payment-secret-cipher.js";
import { MercadoPagoOAuthController } from "../presentation/http/mercadopago-oauth.controller.js";

test("Mercado Pago validates the return context and only saves verified token responses", async () => {
  const before = { ...process.env };
  const fetchBefore = globalThis.fetch;
  Object.assign(process.env, { MERCADOPAGO_OAUTH_APP_ID: "app_test", MERCADOPAGO_OAUTH_CLIENT_SECRET: "test_secret", MERCADOPAGO_OAUTH_REDIRECT_URI: "https://api.example.com/payment/mercadopago/callback", DASHBOARD_URL: "https://dashboard.example.com" });
  delete process.env.MERCADOPAGO_OAUTH_APP_ID_TEST;
  delete process.env.MERCADOPAGO_OAUTH_CLIENT_SECRET_TEST;
  delete process.env.MERCADOPAGO_OAUTH_REDIRECT_URI_TEST;
  try {
    const repository = new InMemoryPaymentPlatformRepository();
    const link = new CreateMercadoPagoOAuthLinkUseCase(repository);
    const url = new URL((await link.execute("mrc_test_mp", "onboarding")).url);
    const state = url.searchParams.get("state")!;
    assert.equal(url.searchParams.get("redirect_uri"), process.env.MERCADOPAGO_OAUTH_REDIRECT_URI);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.deepEqual(readMercadoPagoOAuthState(state), { merchantId: "mrc_test_mp", returnTo: "onboarding" });
    await assert.rejects(() => link.execute("mrc_test_mp", "https://attacker.example" as never));
    assert.throws(() => readMercadoPagoOAuthState(state.slice(1)), /mercadopago_oauth_state_invalid/);
    assert.throws(() => readMercadoPagoOAuthState(encryptPaymentSecret(JSON.stringify({ merchantId: "mrc_test_mp", returnTo: "onboarding", expiresAt: Date.now() - 1 }))), /mercadopago_oauth_state_invalid/);
    const controller = new MercadoPagoOAuthController(repository);
    assert.equal((await controller.handleOAuthCallback(undefined, state, "access_denied")).url, "https://dashboard.example.com/?mercadopago_error=1#onboarding");
    let exchanges = 0;
    globalThis.fetch = async (_url, init) => {
      exchanges++;
      assert.equal(JSON.parse(String(init?.body)).redirect_uri, process.env.MERCADOPAGO_OAUTH_REDIRECT_URI);
      return new Response(JSON.stringify({ access_token: "test_access", refresh_token: "test_refresh", expires_in: 3600, user_id: 123 }), { status: 200 });
    };
    const result = await controller.handleOAuthCallback("test_code", state);
    assert.equal(result.url, "https://dashboard.example.com/?mercadopago_connected=1#onboarding");
    assert.equal(exchanges, 1);
    assert.equal((await repository.listConnections("mrc_test_mp"))[0]?.status, "active");
    assert.doesNotMatch(JSON.stringify(await repository.listConnections("mrc_test_mp")), /test_access|test_refresh/);
    globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });
    const freshState = new URL((await link.execute("mrc_invalid_mp")).url).searchParams.get("state")!;
    await assert.rejects(() => new HandleMercadoPagoOAuthCallbackUseCase(repository).execute({ code: "test", state: freshState }), /mercadopago_token_response_invalid/);
    assert.deepEqual(await repository.listConnections("mrc_invalid_mp"), []);
  } finally {
    globalThis.fetch = fetchBefore;
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
});
