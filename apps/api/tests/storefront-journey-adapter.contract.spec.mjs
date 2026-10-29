import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nativePrismaWorkerEnvironment } from "./native-prisma-admission-guards.mjs";

test("actual adapter constructors route primary/fallback transports while absent factory preserves defaults", () => {
  const child = spawnSync(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    "--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href,
    fileURLToPath(new URL("./storefront-journey-adapter.worker.mjs", import.meta.url))], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), env: nativePrismaWorkerEnvironment(process.env),
    windowsHide: true, encoding: "utf8", timeout: 30_000, maxBuffer: 500_000,
  });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(result.primaryRouting, true); assert.equal(result.classifierCopyNudgeAndReviews, 5);
  assert.equal(result.fallbackDenied, true); assert.equal(result.defaultProductionPathUnchanged, true);
  assert.equal(result.realProviderCalls, 0); assert.equal(result.fullJourneyProof, false);
});
