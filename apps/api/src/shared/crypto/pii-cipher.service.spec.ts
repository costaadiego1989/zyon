import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptPii,
  encryptPii,
  isPiiEncrypted,
} from "./pii-cipher.service.js";

const testEnv = {
  NODE_ENV: "test",
  AACP_PII_ENC_KEY: "pii-test-key",
} as NodeJS.ProcessEnv;

test("PII cipher encrypts and decrypts round-trip", () => {
  const cipher = encryptPii("12345678901", testEnv);

  assert.notEqual(cipher, "12345678901");
  assert.equal(decryptPii(cipher, testEnv), "12345678901");
});

test("PII cipher output differs across calls", () => {
  const first = encryptPii("11999999999", testEnv);
  const second = encryptPii("11999999999", testEnv);

  assert.notEqual(first, second);
  assert.equal(decryptPii(first, testEnv), "11999999999");
  assert.equal(decryptPii(second, testEnv), "11999999999");
});

test("PII cipher uses dev fallback outside production", () => {
  const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
  const cipher = encryptPii("legacy-dev-phone", env);

  assert.equal(decryptPii(cipher, env), "legacy-dev-phone");
});

test("PII cipher key is mandatory in production", () => {
  assert.throws(
    () => encryptPii("secret", { NODE_ENV: "production" } as NodeJS.ProcessEnv),
    /missing_required_secret:AACP_PII_ENC_KEY/,
  );
});

test("PII cipher detects encrypted payloads", () => {
  assert.equal(isPiiEncrypted("pii_v1:salt:iv:tag:ciphertext"), true);
  assert.equal(isPiiEncrypted("12345678901"), false);
});

test("PII cipher rejects malformed payloads", () => {
  assert.throws(() => decryptPii("pii_v1:missing:parts", testEnv), /pii_cipher_malformed/);
  assert.throws(() => decryptPii("v0:salt:iv:tag:cipher", testEnv), /pii_cipher_unsupported_version/);
});
