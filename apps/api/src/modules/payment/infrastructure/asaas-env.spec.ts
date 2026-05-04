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
