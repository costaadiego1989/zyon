import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nativePrismaWorkerEnvironment } from "./native-prisma-admission-guards.mjs";

const execute = (filename, args) => spawnSync(process.execPath, ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
  fileURLToPath(new URL(filename, import.meta.url)), ...args], {
  env: nativePrismaWorkerEnvironment(process.env), windowsHide: true, encoding: "utf8", timeout: 5000,
});
for (const [name, args] of [
  ["implicit run", []],
  ["ambient database override", ["--local-disposable", "--prisma-loopback-exec", "--url=postgresql://external.invalid/production"]],
  ["duplicate opt-in", ["--local-disposable", "--local-disposable", "--prisma-loopback-exec"]],
]) test(`native bound redemption harness rejects ${name} before Docker/Prisma inspection`, () => {
  const child = execute("./storefront-bound-coupon-redemption.integration.mjs", args);
  assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.stdout, "");
  assert.match(child.stderr, /explicit_bound_redemption_native_flags_required/);
});
test("native bound redemption worker rejects foreign URLs before client import or DB access", () => {
  const child = execute("./storefront-bound-coupon-redemption.native-worker.mjs", ["postgresql://postgres@external.invalid/production", "12345678-1234-1234-1234-123456789abc"]);
  assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.stdout, "");
  assert.match(child.stderr, /AssertionError/); assert.doesNotMatch(child.stderr, /PrismaClientInitializationError/);
});
