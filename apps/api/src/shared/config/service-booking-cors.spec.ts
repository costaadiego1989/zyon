import test from "node:test";
import assert from "node:assert/strict";
import { resolveCorsConfig } from "./cors-config.js";
test("T45 the existing service buyer header crosses only the configured CORS origins", () => {
  const configured = resolveCorsConfig({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "https://store.example.invalid" });
  assert.deepEqual(configured.origin, ["https://store.example.invalid"]); assert.equal(configured.credentials, true);
  assert.ok(configured.allowedHeaders.some(header => header.toLowerCase() === "x-buyer-access-token"));
  assert.equal(resolveCorsConfig({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "" }).origin, false);
});
