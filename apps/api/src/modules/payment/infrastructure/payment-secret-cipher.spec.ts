import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptPaymentSecret,
  encryptPaymentSecret,
} from "./payment-secret-cipher.js";

test("payment connection secrets use authenticated encryption", () => {
  const env = {
    NODE_ENV: "test",
    AACP_PAYMENT_ENC_KEY: "payment-test-key",
  } as NodeJS.ProcessEnv;

  const cipher = encryptPaymentSecret("asaas_api_key", env);

  assert.notEqual(cipher, "asaas_api_key");
  assert.equal(decryptPaymentSecret(cipher, env), "asaas_api_key");
  const [iv, tag, ciphertext] = cipher.split(":");
  const tamperedTag = `${tag?.startsWith("A") ? "B" : "A"}${tag?.slice(1)}`;
  assert.throws(
    () =>
      decryptPaymentSecret(
        `${iv}:${tamperedTag}:${ciphertext}`,
        env,
      ),
  );
});

test("payment secret key is mandatory in production", () => {
  assert.throws(
    () =>
      encryptPaymentSecret("secret", {
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    /missing_required_secret:AACP_PAYMENT_ENC_KEY/,
  );
});
