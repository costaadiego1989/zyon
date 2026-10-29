import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { createTestEnvironment } from "./compiled-test-plan.mjs";
import { captureJourneyRuntimeInputs, recordJourneyRuntimeEmission } from "./storefront-journey-compiled-artifact.mjs";

export function assertJourneyRuntimeEmissionFlags(args) {
  assert.deepEqual(args, ["--emit-current-runtime", "--global-typecheck-waived"], "journey_runtime_exact_emission_flags_required");
}
export function resolveJourneyRuntimeOutDir(outDir) {
  assert.equal(typeof outDir, "string", "journey_runtime_resolved_output_required");
  return resolve(outDir);
}
function statIfPresent(path) {
  try { return lstatSync(path); } catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
}
/** Exact already-owned targets only; no recursive delete or external output. */
export function assertJourneyRuntimeEmissionTargets(apiRoot, outDir, backup) {
  assert.equal(apiRoot, resolve(apiRoot)); assert.equal(outDir, resolve(apiRoot, "dist-test"), "journey_runtime_output_must_be_owned_dist_test");
  assert.equal(dirname(backup), resolve(apiRoot, ".sandbox-state"), "journey_runtime_backup_must_be_owned_state");
  assert.match(backup.slice(dirname(backup).length + 1), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  for (const directory of [apiRoot, resolve(apiRoot, ".sandbox-state"), outDir]) {
    const stat = statIfPresent(directory); if (!stat) continue;
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "journey_runtime_target_symlink_forbidden");
  }
  assert.equal(statIfPresent(backup), undefined, "journey_runtime_backup_must_not_exist");
}

export async function emitCurrentJourneyRuntime() {
  const apiRoot = fileURLToPath(new URL("../", import.meta.url)), normalizedApiRoot = resolve(apiRoot);
  const configPath = resolve(apiRoot, "tsconfig.journey-runtime.json"), configStat = lstatSync(configPath);
  assert.ok(configStat.isFile() && !configStat.isSymbolicLink(), "journey_runtime_fixed_config_required");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined, "journey_runtime_configuration_invalid");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, apiRoot);
  assert.equal(parsed.errors.length, 0, "journey_runtime_configuration_invalid");
  assert.equal(parsed.options.noCheck, true); assert.equal(parsed.options.noEmit, false);
  assert.equal(parsed.options.incremental, false); assert.equal(parsed.options.declaration, false);
  assert.equal(parsed.options.experimentalDecorators, true); assert.equal(parsed.options.emitDecoratorMetadata, true);
  const outDir = resolveJourneyRuntimeOutDir(parsed.options.outDir), backup = resolve(apiRoot, ".sandbox-state", randomUUID());
  assertJourneyRuntimeEmissionTargets(normalizedApiRoot, outDir, backup);
  const require = createRequire(new URL("../package.json", import.meta.url));
  const compiler = require.resolve("typescript/lib/tsc.js"), compilerStat = lstatSync(compiler);
  assert.ok(compilerStat.isFile() && !compilerStat.isSymbolicLink(), "journey_runtime_installed_compiler_required");
  const before = captureJourneyRuntimeInputs();
  mkdirSync(resolve(apiRoot, ".sandbox-state"), { recursive: true });
  // Revalidate immediately before the ONLY move. The previous artifact tree is
  // preserved on success AND failure; partial new output is never attested.
  assertJourneyRuntimeEmissionTargets(normalizedApiRoot, outDir, backup);
  const preservedPreviousTree = existsSync(outDir);
  if (preservedPreviousTree) renameSync(outDir, backup);
  let timedOut = false;
  const child = spawn(process.execPath, ["--max-old-space-size=2048", "--import", new URL("./test-network-guard.mjs", import.meta.url).href,
    compiler, "-p", configPath, "--noCheck"], { cwd: apiRoot, env: createTestEnvironment(process.env), windowsHide: true, stdio: "inherit" });
  let timer;
  const outcome = await new Promise((resolveResult, reject) => {
    timer = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
    child.once("error", reject); child.once("close", (code, signal) => resolveResult({ code, signal }));
  }).finally(() => clearTimeout(timer));
  assert.equal(timedOut, false, "journey_runtime_emission_deadline");
  assert.equal(outcome.code, 0, "journey_runtime_emission_failed"); assert.equal(outcome.signal, null);
  assertJourneyRuntimeEmissionTargets(normalizedApiRoot, outDir, resolve(apiRoot, ".sandbox-state", randomUUID()));
  const evidence = recordJourneyRuntimeEmission(before, { emissionExitCode: outcome.code });
  return { ...evidence, preservedPreviousTree, providerCalls: 0, applicationStarted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertJourneyRuntimeEmissionFlags(process.argv.slice(2));
  console.log(JSON.stringify(await emitCurrentJourneyRuntime()));
}
