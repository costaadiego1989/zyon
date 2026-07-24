import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertRequiredSecretsInProduction,
  requireSecret,
  resolveProductionRequiredSecrets,
} from "./secret-config.js";

describe("requireSecret", () => {
  it("returns the configured value when present", () => {
    const env = { NODE_ENV: "production", JWT_SECRET: "real-secret" } as NodeJS.ProcessEnv;
    assert.equal(requireSecret("JWT_SECRET", "dev", env), "real-secret");
  });

  it("returns the dev fallback outside production when missing", () => {
    const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
    assert.equal(requireSecret("JWT_SECRET", "dev-fallback", env), "dev-fallback");
  });

  it("returns the dev fallback in test when missing", () => {
    const env = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    assert.equal(requireSecret("JWT_SECRET", "dev-fallback", env), "dev-fallback");
  });

  it("throws in production when missing", () => {
    const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    assert.throws(() => requireSecret("JWT_SECRET", "dev", env), /missing_required_secret:JWT_SECRET/);
  });

  it("treats blank values as missing in production", () => {
    const env = { NODE_ENV: "production", JWT_SECRET: "   " } as NodeJS.ProcessEnv;
    assert.throws(() => requireSecret("JWT_SECRET", "dev", env), /missing_required_secret:JWT_SECRET/);
  });
});

describe("assertRequiredSecretsInProduction", () => {
  it("is a no-op outside production", () => {
    const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
    assert.doesNotThrow(() => assertRequiredSecretsInProduction(["JWT_SECRET"], env));
  });

  it("aggregates all missing secrets in production", () => {
    const env = { NODE_ENV: "production", JWT_SECRET: "x" } as NodeJS.ProcessEnv;
    assert.throws(
      () => assertRequiredSecretsInProduction(["JWT_SECRET", "BUYER_JWT_SECRET"], env),
      /missing_required_secrets:BUYER_JWT_SECRET/,
    );
  });

  it("passes when all secrets are present in production", () => {
    const env = {
      NODE_ENV: "production",
      JWT_SECRET: "a",
      BUYER_JWT_SECRET: "b",
    } as NodeJS.ProcessEnv;
    assert.doesNotThrow(() =>
      assertRequiredSecretsInProduction(["JWT_SECRET", "BUYER_JWT_SECRET"], env),
    );
  });
});

describe("resolveProductionRequiredSecrets", () => {
  it("requires only core secrets when optional providers are disabled", () => {
    const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    const names = resolveProductionRequiredSecrets(env);
    assert.deepEqual(names, [
      "DATABASE_URL",
      "JWT_SECRET",
      "BUYER_JWT_SECRET",
      "EMBED_TOKEN_SECRET",
      "AACP_PAYMENT_ENC_KEY",
    ]);
  });

  it("requires Stripe webhook secret when Stripe is configured", () => {
    const env = {
      NODE_ENV: "production",
      STRIPE_SECRET_KEY: "sk_live_x",
    } as NodeJS.ProcessEnv;
    const names = resolveProductionRequiredSecrets(env);
    assert.ok(names.includes("STRIPE_WEBHOOK_SECRET"));
  });

  it("requires Asaas webhook token when Asaas is enabled", () => {
    const env = {
      NODE_ENV: "production",
      ASAAS_ENABLED: "true",
    } as NodeJS.ProcessEnv;
    const names = resolveProductionRequiredSecrets(env);
    assert.ok(names.includes("ASAAS_WEBHOOK_TOKEN"));
  });

  it("requires Redis and ops secrets only behind feature flags", () => {
    const env = {
      NODE_ENV: "production",
      REDIS_ENABLED: "true",
      METRICS_ENABLED: "true",
    } as NodeJS.ProcessEnv;
    const names = resolveProductionRequiredSecrets(env);
    assert.ok(names.includes("REDIS_URL"));
    assert.ok(names.includes("OPS_SHARED_SECRET"));
  });
});
