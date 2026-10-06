import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCorsConfig } from "./cors-config.js";

describe("resolveCorsConfig", () => {
  it("uses the configured allowlist when present", () => {
    const env = {
      NODE_ENV: "production",
      CORS_ALLOWED_ORIGINS: "https://a.com, https://b.com",
    } as NodeJS.ProcessEnv;
    const config = resolveCorsConfig(env);
    assert.deepEqual(config.origin, ["https://a.com", "https://b.com"]);
    assert.equal(config.credentials, true);
  });

  it("fails safe in production with no allowlist", () => {
    const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    const config = resolveCorsConfig(env);
    assert.equal(config.origin, false);
  });

  it("fails safe in production with a blank allowlist", () => {
    const env = { NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "  ,  " } as NodeJS.ProcessEnv;
    const config = resolveCorsConfig(env);
    assert.equal(config.origin, false);
  });

  it("defaults to localhost origins in development", () => {
    const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
    const config = resolveCorsConfig(env);
    assert.ok(config.origin instanceof RegExp && config.origin.test("http://localhost:3000"));
  });

  it("allows the dashboard dev origin (port 5174) in development", () => {
    const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
    const config = resolveCorsConfig(env);
    assert.ok(config.origin instanceof RegExp && config.origin.test("http://localhost:5174"));
    assert.ok(config.allowedHeaders.includes("X-Buyer-Authorization"));
    assert.ok(config.allowedHeaders.includes("X-AI-User-Token"));
  });
});
