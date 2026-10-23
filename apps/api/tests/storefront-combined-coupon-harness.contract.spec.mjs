import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nativePrismaWorkerEnvironment } from "./native-prisma-admission-guards.mjs";

const execute = (filename, args) => spawnSync(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
  fileURLToPath(new URL(filename, import.meta.url)), ...args], {
  env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, encoding: "utf8", timeout: 5000,
});
for (const [name, args] of [["implicit execution", []], ["ambient URL", ["--local-disposable", "--prisma-loopback-exec", "--url=postgresql://external.invalid/production"]],
  ["duplicate opt-in", ["--local-disposable", "--local-disposable", "--prisma-loopback-exec"]]]) test("combined coupon harness rejects " + name + " before Docker/client inspection", () => {
  const child = execute("./storefront-combined-coupon.integration.mjs", args);
  assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.stdout, "");
  assert.match(child.stderr, /explicit_combined_coupon_native_flags_required/);
});
test("combined coupon worker rejects foreign target before Prisma import or access", () => {
  const child = execute("./storefront-combined-coupon.native-worker.mjs", ["postgresql://postgres@external.invalid/production", "12345678-1234-1234-1234-123456789abc"]);
  assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.stdout, "");
  assert.match(child.stderr, /AssertionError/); assert.doesNotMatch(child.stderr, /PrismaClientInitializationError/);
});
