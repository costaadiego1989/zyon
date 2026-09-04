import assert from "node:assert/strict";
import * as fs from "node:fs";
import { describe, it } from "node:test";
import { resolveSentryConfig } from "./sentry.config.js";

describe("resolveSentryConfig", () => {
  it("is disabled when SENTRY_DSN is missing", () => {
    const config = resolveSentryConfig({ NODE_ENV: "production" });
    assert.equal(config.enabled, false);
    assert.equal(config.dsn, undefined);
  });

  it("is disabled when SENTRY_DSN is blank", () => {
    const config = resolveSentryConfig({
      SENTRY_DSN: "   ",
      NODE_ENV: "production",
    });
    assert.equal(config.enabled, false);
  });

  it("is enabled when SENTRY_DSN is set", () => {
    const config = resolveSentryConfig({
      SENTRY_DSN: "https://public@sentry.example/1",
      NODE_ENV: "production",
    });
    assert.equal(config.enabled, true);
    assert.equal(config.dsn, "https://public@sentry.example/1");
  });

  it("uses NODE_ENV as the Sentry environment", () => {
    const config = resolveSentryConfig({
      SENTRY_DSN: "https://k@o.ingest.sentry.io/1",
      NODE_ENV: "staging",
    });
    assert.equal(config.environment, "staging");
  });

  it("defaults the environment to development", () => {
    const config = resolveSentryConfig({
      SENTRY_DSN: "https://k@o.ingest.sentry.io/1",
    });
    assert.equal(config.environment, "development");
  });

  it("clamps sample rates to the documented [0, 1] range", () => {
    const high = resolveSentryConfig({
      SENTRY_DSN: "https://k@o.ingest.sentry.io/1",
      SENTRY_TRACES_SAMPLE_RATE: "2.7",
      SENTRY_PROFILES_SAMPLE_RATE: "-0.5",
    });
    assert.equal(high.tracesSampleRate, 1);
    assert.equal(high.profilesSampleRate, 0);

    const fallback = resolveSentryConfig({
      SENTRY_DSN: "https://k@o.ingest.sentry.io/1",
      SENTRY_TRACES_SAMPLE_RATE: "not-a-number",
    });
    // Default is 0.1 when a non-numeric value is supplied.
    assert.equal(fallback.tracesSampleRate, 0.1);
  });

  it("honours SENTRY_RELEASE when provided", () => {
    const config = resolveSentryConfig({
      SENTRY_DSN: "https://k@o.ingest.sentry.io/1",
      SENTRY_RELEASE: "my-app@1.2.3",
    });
    assert.equal(config.release, "my-app@1.2.3");
  });

  it("falls back to the package.json version when release is not set", () => {
    // Pass the cwd as the package root to make the test deterministic
    // regardless of where the spec is being executed from.
    const config = resolveSentryConfig(
      { SENTRY_DSN: "https://k@o.ingest.sentry.io/1" },
      process.cwd(),
    );
    const pkg = fs.readFileSync(`${process.cwd()}/package.json`, "utf8");
    const parsed = JSON.parse(pkg) as { version?: string };
    assert.equal(config.release, parsed.version);
  });
});
