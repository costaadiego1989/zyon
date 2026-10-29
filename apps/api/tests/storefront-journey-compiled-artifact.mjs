import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, lstatSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const apiRoot = fileURLToPath(new URL("../", import.meta.url)), workspaceRoot = resolve(apiRoot, "../..");
const manifestPath = resolve(apiRoot, ".sandbox-state/lote63-journey-compiled-manifest.json");
const hash = value => createHash("sha256").update(value).digest("hex");

/** Small fixed inventory, not a compiler/build framework or proof that an
 * arbitrary invocation compiled. Root records it ONLY after real tsc exit0
 * with candidate sources frozen. Every subsequent change invalidates the gate. */
function snapshot(includeEmittedArtifacts = true) {
  const entries = [];
  function add(file) {
    const stat = lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), "journey_artifact_regular_file_required");
    entries.push({ path: relative(workspaceRoot, file).replaceAll("\\", "/"), sha256: hash(readFileSync(file)) });
  }
  function walk(root, extensions) {
    assert.ok(existsSync(root), "journey_artifact_inventory_directory_required");
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = resolve(root, entry.name);
      assert.equal(entry.isSymbolicLink(), false, "journey_artifact_inventory_symlink_forbidden");
      if (entry.isDirectory()) walk(file, extensions);
      else if (extensions.some(extension => entry.name.endsWith(extension))) add(file);
    }
  }
  walk(resolve(apiRoot, "src"), [".ts", ".json"]);
  if (includeEmittedArtifacts) walk(resolve(apiRoot, "dist-test"), [".js", ".json"]);
  walk(resolve(apiRoot, "tests"), [".mjs", ".sql"]);
  for (const name of ["package.json", "tsconfig.json", "tsconfig.test-runner.json", "prisma.config.ts", "prisma/schema.prisma"]) add(resolve(apiRoot, name));
  for (const name of ["package.json", "pnpm-lock.yaml", "tsconfig.base.json"]) add(resolve(workspaceRoot, name));
  // Both checked-emission phases must use the same installed compiler and
  // standard type libraries, not only the same declared dependency version.
  const compilerRoot = resolve(apiRoot, "node_modules/typescript");
  for (const name of ["package.json", "lib/tsc.js", "lib/_tsc.js", "lib/typescript.js"]) add(resolve(compilerRoot, name));
  for (const entry of readdirSync(resolve(compilerRoot, "lib"), { withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith(".d.ts")) add(resolve(compilerRoot, "lib", entry.name));
  const packages = resolve(workspaceRoot, "packages");
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = resolve(packages, entry.name);
    if (existsSync(resolve(root, "package.json"))) add(resolve(root, "package.json"));
    for (const sub of ["src", "dist"]) if (existsSync(resolve(root, sub))) walk(resolve(root, sub), [".ts", ".js", ".json"]);
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  assert.equal(new Set(entries.map(entry => entry.path)).size, entries.length, "journey_artifact_inventory_duplicate");
  if (includeEmittedArtifacts) for (const required of ["apps/api/dist-test/app.module.js", "apps/api/dist-test/test-runner.js",
    "apps/api/dist-test/modules/storefront/infrastructure/adapters/storefront-conversation.adapter.js"])
    assert.ok(entries.some(entry => entry.path === required), "journey_canonical_compiled_artifact_required");
  return entries;
}

/** Root may run full --noEmit checking and emission in separate, serial tsc
 * processes to reduce peak RAM. Compare this immutable-input digest before
 * and after BOTH exit0 gates; emission alone never authorizes attestation.
 * Package dist files remain inputs. Only this API's generated dist-test is
 * excluded, because its contents are the output checked by the final manifest.
 */
export function captureJourneyCompilationInputs() {
  const entries = snapshot(false);
  return Object.freeze({ entries: entries.length, inventorySha256: hash(JSON.stringify(entries)) });
}

export function assertFreshJourneyCompilation() {
  const stat = lstatSync(manifestPath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8_000_000, "journey_root_compile_manifest_required");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), ["version", "artifactTree", "rootReportedCompileExitCode", "recordedAt", "inventorySha256", "entries"].sort(), "journey_root_compile_manifest_invalid");
  assert.equal(manifest.version, 1); assert.equal(manifest.artifactTree, "dist-test"); assert.equal(manifest.rootReportedCompileExitCode, 0);
  assert.ok(typeof manifest.recordedAt === "string" && Number.isFinite(Date.parse(manifest.recordedAt)));
  assert.equal(hash(JSON.stringify(manifest.entries)), manifest.inventorySha256, "journey_root_compile_manifest_corrupt");
  const current = snapshot();
  assert.equal(hash(JSON.stringify(current)), manifest.inventorySha256, "journey_source_or_artifact_drift_after_root_compilation");
  return Object.freeze({ artifactTree: "dist-test", entries: current.length, inventorySha256: manifest.inventorySha256,
    rootReportedCompileExitCode: 0, sourceAndArtifactContentUnchanged: true });
}

// V2 is deliberately separate from the checked V1 manifest and its inventory.
// User waived global checking, not source freshness or honest evidence labels.
const runtimeManifestPath = resolve(apiRoot, ".sandbox-state/lote77-journey-runtime-manifest.json");
export function journeyRuntimeArtifactEntries() {
  return ["app.module.js", "modules/checkout/domain/services/checkout-explicit-address.schema.js",
    "modules/embed/application/update-marketplace-checkout-address.service.js",
    "modules/cross-sell/infrastructure/repositories/prisma-widget-cross-sell-checkout.adapter.js",
    "modules/cross-sell/domain/contracts/widget-cross-sell-checkout-command.schemas.js",
    "modules/storefront/infrastructure/adapters/storefront-conversation.adapter.js",
    "modules/buyer-account/domain/services/buyer-jwt.service.js", "shared/auth/realtime-capability.js", "shared/http/api-versioning.js"];
}
function runtimeSnapshot(includeEmittedArtifacts) {
  const entries = snapshot(false);
  function add(file) {
    const stat = lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), "journey_runtime_regular_file_required");
    entries.push({ path: relative(workspaceRoot, file).replaceAll("\\", "/"), sha256: hash(readFileSync(file)) });
  }
  add(resolve(apiRoot, "tsconfig.journey-runtime.json"));
  if (includeEmittedArtifacts) {
    function walk(root) {
      const stat = lstatSync(root);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "journey_runtime_directory_symlink_forbidden");
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        assert.equal(entry.isSymbolicLink(), false, "journey_runtime_artifact_symlink_forbidden");
        const file = resolve(root, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.endsWith(".js") || entry.name.endsWith(".json")) add(file);
      }
    }
    walk(resolve(apiRoot, "dist-test"));
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  assert.equal(new Set(entries.map(entry => entry.path)).size, entries.length, "journey_runtime_inventory_duplicate");
  return entries;
}
export function captureJourneyRuntimeInputs() {
  const entries = runtimeSnapshot(false);
  return Object.freeze({ entries: entries.length, inventorySha256: hash(JSON.stringify(entries)) });
}
/** Pure metadata/refusal contract. Actual callers always supply a freshly read
 * local snapshot, never a manifest's own list as evidence of its freshness. */
export function validateJourneyRuntimeManifest(manifest, current) {
  assert.ok(manifest && typeof manifest === "object" && !Array.isArray(manifest));
  assert.deepEqual(Object.keys(manifest).sort(), ["version", "artifactTree", "validationMode", "globalTypecheck", "emissionExitCode",
    "recordedAt", "inventorySha256", "entries"].sort(), "journey_runtime_manifest_shape_invalid");
  assert.equal(manifest.version, 2); assert.equal(manifest.artifactTree, "dist-test");
  assert.equal(manifest.validationMode, "runtime-emission-only"); assert.equal(manifest.globalTypecheck, "waived-by-user");
  assert.equal(manifest.emissionExitCode, 0);
  assert.ok(typeof manifest.recordedAt === "string" && Number.isFinite(Date.parse(manifest.recordedAt)), "journey_runtime_manifest_timestamp_invalid");
  assert.ok(Array.isArray(manifest.entries) && manifest.entries.length > 0 && manifest.entries.length <= 50_000);
  for (const entry of manifest.entries) {
    assert.ok(entry && typeof entry === "object" && !Array.isArray(entry));
    assert.deepEqual(Object.keys(entry).sort(), ["path", "sha256"]);
    assert.ok(typeof entry.path === "string" && !entry.path.includes("\\") && !entry.path.startsWith("/")
      && entry.path.split("/").every(part => part && part !== "." && part !== "..") && !entry.path.includes(":"));
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(new Set(manifest.entries.map(entry => entry.path)).size, manifest.entries.length, "journey_runtime_manifest_duplicate");
  assert.equal(hash(JSON.stringify(manifest.entries)), manifest.inventorySha256, "journey_runtime_manifest_corrupt");
  assert.equal(hash(JSON.stringify(current)), manifest.inventorySha256, "journey_runtime_source_or_artifact_drift");
  for (const name of [...journeyRuntimeArtifactEntries().map(path => `apps/api/dist-test/${path}`), "apps/api/tsconfig.journey-runtime.json"])
    assert.ok(current.some(entry => entry.path === name), "journey_runtime_required_artifact_missing");
  return Object.freeze({ artifactTree: "dist-test", validationMode: "runtime-emission-only", globalTypecheck: "waived-by-user",
    emissionExitCode: 0, entries: current.length, inventorySha256: manifest.inventorySha256, sourceAndArtifactContentUnchanged: true });
}
export function assertFreshJourneyRuntimeArtifacts() {
  const stat = lstatSync(runtimeManifestPath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8_000_000, "journey_runtime_manifest_required");
  return validateJourneyRuntimeManifest(JSON.parse(readFileSync(runtimeManifestPath, "utf8")), runtimeSnapshot(true));
}
export function recordJourneyRuntimeEmission(before, result) {
  assert.deepEqual(result, { emissionExitCode: 0 }, "journey_successful_runtime_emission_required");
  assert.deepEqual(captureJourneyRuntimeInputs(), before, "journey_runtime_inputs_changed_during_emission");
  const entries = runtimeSnapshot(true), manifest = { version: 2, artifactTree: "dist-test", validationMode: "runtime-emission-only",
    globalTypecheck: "waived-by-user", emissionExitCode: 0, recordedAt: new Date().toISOString(), inventorySha256: hash(JSON.stringify(entries)), entries };
  const evidence = validateJourneyRuntimeManifest(manifest, entries);
  assert.deepEqual(captureJourneyRuntimeInputs(), before, "journey_runtime_inputs_changed_before_recording");
  const directory = dirname(runtimeManifestPath);
  const statIfPresent = path => { try { return lstatSync(path); } catch (error) { if (error?.code === "ENOENT") return undefined; throw error; } };
  const directoryStat = statIfPresent(directory);
  if (directoryStat) assert.ok(directoryStat.isDirectory() && !directoryStat.isSymbolicLink());
  mkdirSync(directory, { recursive: true });
  const manifestStat = statIfPresent(runtimeManifestPath);
  if (manifestStat) assert.ok(manifestStat.isFile() && !manifestStat.isSymbolicLink());
  writeFileSync(runtimeManifestPath, JSON.stringify(manifest) + "\n", { mode: 0o600 });
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.deepEqual(process.argv.slice(2), ["--record-root-compile-exit0"], "journey_explicit_root_compile_attestation_required");
  const entries = snapshot(), inventorySha256 = hash(JSON.stringify(entries));
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ version: 1, artifactTree: "dist-test", rootReportedCompileExitCode: 0,
    recordedAt: new Date().toISOString(), inventorySha256, entries }) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ rootCompilationAttestationRecorded: true, entries: entries.length, inventorySha256,
    providerCalls: 0, applicationStarted: false }));
}
