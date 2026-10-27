import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nativePrismaWorkerEnvironment } from "./native-prisma-admission-guards.mjs";

const parent = new URL("./widget-cross-sell-checkout.integration.mjs", import.meta.url);
for (const args of [[], ["--local-disposable"], ["--local-disposable", "--prisma-loopback-exec", "--unknown"]]) {
  test(`native widget harness refuses incomplete/unknown flags before Docker: ${args.length}`, () => {
    const child = spawnSync(process.execPath, [fileURLToPath(parent), ...args], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), env: nativePrismaWorkerEnvironment(process.env),
      encoding: "utf8", timeout: 10000, windowsHide: true,
    });
    assert.equal(child.status, 1); assert.match(child.stderr, /explicit_widget_checkout_native_flags_required/);
    assert.equal(child.stdout, "");
  });
}
test("native widget worker verifies URL/environment/marker before importing the command", () => {
  const worker = readFileSync(new URL("./widget-cross-sell-checkout.native-worker.mjs", import.meta.url), "utf8");
  assert.ok(worker.indexOf("assertNativePrismaUrl(url)") < worker.indexOf('await import("@prisma/client")'));
  assert.ok(worker.indexOf("assert.deepEqual(marker, [{ run_id: runId }])") < worker.indexOf('await import("../src/modules/cross-sell'));
  const source = readFileSync(parent, "utf8");
  assert.match(source, /nativePrismaWorkerEnvironment\(process.env\)/);
  assert.match(source, /await terminateOwnedNativeWorker\(worker\)/);
  assert.match(source, /await db.dispose\(\)/);
  assert.match(source, /sockets: 0, children: 0/);
});
