import test from "node:test";
import assert from "node:assert/strict";
import { decryptCommerceSecret, encryptCommerceSecret } from "./commerce-secret-cipher.js";

test("encrypt/decrypt round-trips with explicit key", () => {
  const env = { NODE_ENV: "test", AACP_COMMERCE_ENC_KEY: "unit-test-key" } as NodeJS.ProcessEnv;
  const cipher = encryptCommerceSecret("shpat_super_secret", env);
  assert.notEqual(cipher, "shpat_super_secret");
  assert.equal(decryptCommerceSecret(cipher, env), "shpat_super_secret");
});

test("ciphertext differs across calls (random IV)", () => {
  const env = { NODE_ENV: "test", AACP_COMMERCE_ENC_KEY: "k" } as NodeJS.ProcessEnv;
  const a = encryptCommerceSecret("token", env);
  const b = encryptCommerceSecret("token", env);
  assert.notEqual(a, b);
  assert.equal(decryptCommerceSecret(a, env), "token");
  assert.equal(decryptCommerceSecret(b, env), "token");
});

test("dev fallback key works without AACP_COMMERCE_ENC_KEY outside production", () => {
  const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
  const cipher = encryptCommerceSecret("dev_token", env);
  assert.equal(decryptCommerceSecret(cipher, env), "dev_token");
});

test("missing key in production throws on encrypt", () => {
  const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  assert.throws(() => encryptCommerceSecret("x", env), /missing_required_secret:AACP_COMMERCE_ENC_KEY/);
});

test("malformed payload rejected", () => {
  const env = { NODE_ENV: "test", AACP_COMMERCE_ENC_KEY: "k" } as NodeJS.ProcessEnv;
  assert.throws(() => decryptCommerceSecret("not-a-valid-cipher", env), /commerce_secret_cipher_malformed/);
});
