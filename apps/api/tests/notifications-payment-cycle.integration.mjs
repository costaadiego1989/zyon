import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTestEnvironment } from "./compiled-test-plan.mjs";

const [mode, ...extra] = process.argv.slice(2);
assert.ok(["--source", "--compiled"].includes(mode) && !extra.length, "explicit_module_cycle_mode_required");
for (const order of ["payment-first", "checkout-first", "app-root"]) {
  test(`${mode} isolated ${order} imports resolve with real Nest module metadata`, { timeout: 150_000 }, async () => {
    const args = ["--import", new URL("./test-network-guard.mjs", import.meta.url).href,
      ...(mode === "--source" ? ["--loader", new URL("./ready-prod-loader.mjs", import.meta.url).href] : []),
      fileURLToPath(new URL("./notifications-payment-cycle.worker.mjs", import.meta.url)), mode, order];
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: createTestEnvironment(process.env), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 140_000 });
      let stdout = "", stderr = "";
      child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
      child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, 0, result.stderr);
    const evidence = JSON.parse(result.stdout.trim());
    assert.equal(evidence.order, order); assert.equal(evidence.fullNestBoot, false);
    assert.equal(evidence.emittedDecoratorMetadata, mode === "--compiled" ? "verified" : "not_asserted_source_loader");
    console.log(`# ${result.stdout.trim()}`);
  });
}
