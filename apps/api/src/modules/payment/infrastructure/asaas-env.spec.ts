import test from "node:test";
import assert from "node:assert/strict";
import { isAsaasConfigured, parseAsaasSandboxEnv, readAsaasConnection } from "./asaas-env.js";

test("parseAsaasSandboxEnv", () => {
  const prev = process.env.ASAAS_SANDBOX;
  try {
    delete process.env.ASAAS_SANDBOX;
    assert.equal(parseAsaasSandboxEnv(), false);
    process.env.ASAAS_SANDBOX = "TRUE";
    assert.equal(parseAsaasSandboxEnv(), true);
  } finally {
    if (prev === undefined) delete process.env.ASAAS_SANDBOX;
    else process.env.ASAAS_SANDBOX = prev;
  }
});

test("readAsaasConnection sandbox vs production", () => {
  const keys = [
    "ASAAS_SANDBOX",
    "ASAAS_API_KEY_SANDBOX",
    "ASAAS_API_KEY",
    "ASAAS_API_BASE_URL",
    "ASAAS_API_BASE_URL_SANDBOX"
  ] as const;
  const backup: Partial<Record<(typeof keys)[number], string | undefined>> = {};
  for (const k of keys) backup[k] = process.env[k];
  try {
    for (const k of keys) delete process.env[k];

    process.env.ASAAS_SANDBOX = "true";
    process.env.ASAAS_API_KEY_SANDBOX = "sk_sandbox";
    let sb = readAsaasConnection();
    assert.equal(sb.sandbox, true);
    assert.equal(sb.apiKey, "sk_sandbox");
    assert.match(sb.baseUrl, /sandbox/i);

    process.env.ASAAS_SANDBOX = "false";
    process.env.ASAAS_API_KEY = "sk_live";
    sb = readAsaasConnection();
    assert.equal(sb.sandbox, false);
    assert.equal(sb.apiKey, "sk_live");
    assert.equal(sb.baseUrl, "https://api.asaas.com");

    delete process.env.ASAAS_API_KEY;
    assert.equal(isAsaasConfigured(), false);
  } finally {
    for (const k of keys) {
      const v = backup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// Regression: the host URL must be the BASE ORIGIN only — no `/v3` suffix.
// The adapter appends `/v3/...` itself. A base like `https://www.asaas.com/api/v3`
// causes `https://www.asaas.com/api/v3/v3/payments` (404) and worse, routes
// sandbox traffic to the PRODUCTION domain (`www.asaas.com`).
test("readAsaasConnection strips trailing /v3 from env-provided base URLs", () => {
  const keys = [
    "ASAAS_SANDBOX",
    "ASAAS_API_KEY_SANDBOX",
    "ASAAS_API_KEY",
    "ASAAS_API_BASE_URL",
    "ASAAS_API_BASE_URL_SANDBOX",
    "ASAAS_BASE_URL",
    "ASAAS_BASE_URL_SANDBOX"
  ] as const;
  const backup: Partial<Record<(typeof keys)[number], string | undefined>> = {};
  for (const k of keys) backup[k] = process.env[k];
  try {
    for (const k of keys) delete process.env[k];

    // Sandbox URL accidentally includes /api/v3 suffix
    process.env.ASAAS_SANDBOX = "true";
    process.env.ASAAS_API_KEY_SANDBOX = "sk_sandbox";
    process.env.ASAAS_BASE_URL_SANDBOX = "https://www.asaas.com/api/v3";
    let sb = readAsaasConnection();
    assert.equal(sb.sandbox, true);
    // Must be the production ORIGIN for sandbox? No — the bug is that www.asaas.com
    // is the PRODUCTION domain. With ASAAS_SANDBOX=true the user clearly intends
    // sandbox, so the resolver must substitute the real sandbox origin rather
    // than honor a mistakenly-pointed-at-production URL.
    assert.notEqual(sb.baseUrl, "https://www.asaas.com/api/v3");
    assert.notEqual(sb.baseUrl, "https://www.asaas.com");
    assert.match(sb.baseUrl, /sandbox/i);

    // Production URL with trailing slash and /v3 should be normalized to origin
    delete process.env.ASAAS_SANDBOX;
    process.env.ASAAS_API_KEY = "sk_live";
    process.env.ASAAS_BASE_URL = "https://api.asaas.com/api/v3/";
    const prod = readAsaasConnection();
    assert.equal(prod.sandbox, false);
    assert.equal(prod.baseUrl, "https://api.asaas.com");
  } finally {
    for (const k of keys) {
      const v = backup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
