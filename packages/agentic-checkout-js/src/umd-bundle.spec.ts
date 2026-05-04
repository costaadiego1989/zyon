import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const umdPath = path.join(__dirname, "..", "dist-umd", "aacp-agentic-checkout.umd.min.cjs");

function pickExports(loaded: Record<string, unknown>): Record<string, unknown> {
  if (typeof loaded.AgenticCheckoutEmbedClient === "function") {
    return loaded;
  }
  const d = loaded.default;
  return typeof d === "object" && d !== null ? (d as Record<string, unknown>) : {};
}

test("UMD bundle is loadable and exposes embed client helpers", async () => {
  const req = createRequire(import.meta.url);
  const loaded = req(umdPath) as Record<string, unknown>;
  const api = pickExports(loaded);

  assert.equal(typeof api.normalizeEmbedOrigin, "function");
  assert.equal(typeof api.AgenticCheckoutEmbedClient, "function");
  assert.equal(typeof api.AgenticCheckoutHttpError, "function");

  assert.equal((api.normalizeEmbedOrigin as (s: string) => string)("https://x/ "), "https://x");
});
