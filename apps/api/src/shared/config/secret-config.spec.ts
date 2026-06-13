import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertRequiredSecretsInProduction,
  requireSecret,
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
