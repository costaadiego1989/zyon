import assert from "node:assert/strict";
import test from "node:test";
import { parseMercadoPagoSandboxEnv, readMercadoPagoConnection } from "./mercadopago-env.js";

test("non-production Mercado Pago always selects sandbox credentials", () => {
  const env = {
    NODE_ENV: "development",
    MERCADOPAGO_SANDBOX: "false",
    MERCADOPAGO_ACCESS_TOKEN: "live-token-must-not-be-selected",
    MERCADOPAGO_PUBLIC_KEY: "live-key-must-not-be-selected",
    MERCADOPAGO_ACCESS_TOKEN_SANDBOX: "test-token",
    MERCADOPAGO_PUBLIC_KEY_SANDBOX: "test-key",
  };

  assert.equal(parseMercadoPagoSandboxEnv(env), true);
  assert.deepEqual(readMercadoPagoConnection(env), {
    sandbox: true,
    accessToken: "test-token",
    publicKey: "test-key",
    baseUrl: "https://api.mercadopago.com",
  });
});

test("production only selects Mercado Pago sandbox explicitly", () => {
  assert.equal(parseMercadoPagoSandboxEnv({ NODE_ENV: "production" }), false);
  assert.equal(parseMercadoPagoSandboxEnv({ NODE_ENV: "production", MERCADOPAGO_SANDBOX: "true" }), true);
});
