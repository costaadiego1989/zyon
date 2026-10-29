import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as artifacts from "./storefront-journey-compiled-artifact.mjs";

// Pure manifest and owned temporary-path contracts only. Never invoke a
// compiler, AppModule, Docker, database, provider or the actual budget ledger.
const hash = value => createHash("sha256").update(value).digest("hex");
const entries = () => artifacts.journeyRuntimeArtifactEntries().map(path => ({ path: `apps/api/dist-test/${path}`, sha256: "a".repeat(64) }))
  .concat([{ path: "apps/api/tsconfig.journey-runtime.json", sha256: "b".repeat(64) }])
  .sort((a, b) => a.path.localeCompare(b.path, "en"));
const manifest = current => ({ version: 2, artifactTree: "dist-test", validationMode: "runtime-emission-only",
  globalTypecheck: "waived-by-user", emissionExitCode: 0, recordedAt: "2026-10-21T00:00:00.000Z",
  inventorySha256: hash(JSON.stringify(current)), entries: current });

test("V2 exports nine canonical runtime artifacts including API versioning, without test-runner, and leaves V1 separate", () => {
  assert.equal(typeof artifacts.journeyRuntimeArtifactEntries, "function");
  const paths = artifacts.journeyRuntimeArtifactEntries();
  assert.equal(paths.length, 9); assert.equal(new Set(paths).size, 9);
  assert.ok(paths.includes("app.module.js"));
  assert.ok(paths.includes("modules/buyer-account/domain/services/buyer-jwt.service.js"));
  assert.ok(paths.includes("shared/auth/realtime-capability.js"));
  assert.ok(paths.includes("shared/http/api-versioning.js"));
  assert.equal(paths.some(path => path.includes("test-runner")), false);
  assert.equal(typeof artifacts.assertFreshJourneyCompilation, "function");
  assert.equal(typeof artifacts.assertFreshJourneyRuntimeArtifacts, "function");
});

test("V2 technical evidence explicitly refuses to claim global checking", () => {
  const current = entries(), result = artifacts.validateJourneyRuntimeManifest(manifest(current), current);
  assert.equal(result.validationMode, "runtime-emission-only");
  assert.equal(result.globalTypecheck, "waived-by-user"); assert.equal(result.emissionExitCode, 0);
  assert.equal(result.sourceAndArtifactContentUnchanged, true);
  assert.equal("rootReportedCompileExitCode" in result, false);
});

for (const [name, change] of [
  ["V1", { version: 1 }], ["typecheck claim", { globalTypecheck: "passed" }],
  ["checked mode", { validationMode: "full-typecheck" }], ["failed emission", { emissionExitCode: 1 }],
  ["invented compile evidence", { rootReportedCompileExitCode: 0 }], ["wrong artifact tree", { artifactTree: "dist" }],
  ["invalid timestamp", { recordedAt: "not-a-date" }], ["corrupt inventory", { inventorySha256: "0".repeat(64) }],
]) test(`V2 rejects ${name} instead of blessing stale or unchecked claims`, () => {
  const current = entries(); assert.throws(() => artifacts.validateJourneyRuntimeManifest({ ...manifest(current), ...change }, current));
});

test("V2 refuses source/artifact drift, missing required outputs and missing runtime configuration", () => {
  const current = entries(), original = manifest(current);
  assert.throws(() => artifacts.validateJourneyRuntimeManifest(original, [{ ...current[0], sha256: "c".repeat(64) }, ...current.slice(1)]));
  for (const absent of ["apps/api/dist-test/app.module.js", "apps/api/dist-test/shared/http/api-versioning.js", "apps/api/tsconfig.journey-runtime.json"]) {
    const incomplete = current.filter(entry => entry.path !== absent);
    assert.throws(() => artifacts.validateJourneyRuntimeManifest(manifest(incomplete), incomplete));
  }
});

test("fixed runtime configuration explicitly emits API versioning without importing test-runner", () => {
  const apiRoot = fileURLToPath(new URL("../", import.meta.url));
  const configPath = fileURLToPath(new URL("../tsconfig.journey-runtime.json", import.meta.url));
  const raw = ts.readConfigFile(configPath, ts.sys.readFile); assert.equal(raw.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, apiRoot);
  assert.equal(parsed.errors.length, 0);
  assert.ok(parsed.fileNames.some(path => resolve(path) === resolve(apiRoot, "src/shared/http/api-versioning.ts")));
  assert.equal(parsed.fileNames.some(path => path.endsWith("/test-runner.ts") || path.endsWith("\\test-runner.ts")), false);
});

test("V2 refuses duplicate, traversal and malformed hash inventory entries", () => {
  const current = entries();
  for (const changed of [[...current, current[0]], [{ path: "../foreign.js", sha256: "a".repeat(64) }, ...current],
    [{ ...current[0], sha256: "not-a-hash" }, ...current.slice(1)]])
    assert.throws(() => artifacts.validateJourneyRuntimeManifest(manifest(changed), changed));
});

async function pathFixture(work) {
  const root = await mkdtemp(resolve(tmpdir(), "aacp-runtime-emission-contract-"));
  try { const apiRoot = resolve(root, "apps/api"); await mkdir(resolve(apiRoot, ".sandbox-state"), { recursive: true }); await work(apiRoot, root); }
  finally { assert.equal(resolve(root, ".."), resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
}

test("emitter accepts only exact two flags, never arbitrary config/output/credentials", async () => {
  const emitter = await import("./storefront-journey-runtime-emission.mjs");
  assert.doesNotThrow(() => emitter.assertJourneyRuntimeEmissionFlags(["--emit-current-runtime", "--global-typecheck-waived"]));
  for (const flags of [[], ["--emit-current-runtime"], ["--emit-current-runtime", "--global-typecheck-waived", "--outDir=foreign"],
    ["--emit-current-runtime", "--global-typecheck-waived", "--api-key=forbidden"]])
    assert.throws(() => emitter.assertJourneyRuntimeEmissionFlags(flags));
});

test("emitter preserves exact owned output/UUID backup targets and refuses broad, nested or foreign paths", async () => {
  const emitter = await import("./storefront-journey-runtime-emission.mjs");
  await pathFixture(async apiRoot => {
    const outDir = resolve(apiRoot, "dist-test"), backup = resolve(apiRoot, ".sandbox-state", randomUUID());
    assert.doesNotThrow(() => emitter.assertJourneyRuntimeEmissionTargets(apiRoot, outDir, backup));
    for (const [output, saved] of [[apiRoot, backup], [resolve(apiRoot, "dist"), backup],
      [outDir, resolve(apiRoot, ".sandbox-state")], [outDir, resolve(apiRoot, "outside", randomUUID())],
      [outDir, resolve(apiRoot, ".sandbox-state", "not-a-uuid")]])
      assert.throws(() => emitter.assertJourneyRuntimeEmissionTargets(apiRoot, output, saved));
  });
});

test("real TypeScript parsed forward-slash outDir normalizes before the exact owned-path check", async () => {
  const emitter = await import("./storefront-journey-runtime-emission.mjs");
  await pathFixture(async apiRoot => {
    const parsed = ts.parseJsonConfigFileContent({ compilerOptions: { outDir: "dist-test" }, files: ["src/app.module.ts"] }, ts.sys, apiRoot);
    assert.equal(parsed.errors.length, 0); assert.equal(typeof parsed.options.outDir, "string");
    assert.ok(parsed.options.outDir.includes("/"), "actual_typescript_forward_slash_representation_required");
    const outDir = emitter.resolveJourneyRuntimeOutDir(parsed.options.outDir);
    assert.equal(outDir, resolve(apiRoot, "dist-test"));
    assert.doesNotThrow(() => emitter.assertJourneyRuntimeEmissionTargets(apiRoot, outDir, resolve(apiRoot, ".sandbox-state", randomUUID())));
    for (const invalid of [undefined, null, {}, 123]) assert.throws(() => emitter.resolveJourneyRuntimeOutDir(invalid));
    const foreign = emitter.resolveJourneyRuntimeOutDir(resolve(apiRoot, "foreign").replaceAll("\\", "/"));
    assert.throws(() => emitter.assertJourneyRuntimeEmissionTargets(apiRoot, foreign, resolve(apiRoot, ".sandbox-state", randomUUID())));
  });
});

test("emitter refuses an already occupied backup and symlink output before rename", async () => {
  const emitter = await import("./storefront-journey-runtime-emission.mjs");
  await pathFixture(async (apiRoot, root) => {
    const outDir = resolve(apiRoot, "dist-test"), backup = resolve(apiRoot, ".sandbox-state", randomUUID());
    await mkdir(backup);
    assert.throws(() => emitter.assertJourneyRuntimeEmissionTargets(apiRoot, outDir, backup));
    const outside = resolve(root, "foreign"); await mkdir(outside);
    await symlink(outside, outDir, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => emitter.assertJourneyRuntimeEmissionTargets(apiRoot, outDir, resolve(apiRoot, ".sandbox-state", randomUUID())));
  });
});

test("emitter refuses dangling symlink output and backup rather than following an absent foreign target", async () => {
  const emitter = await import("./storefront-journey-runtime-emission.mjs");
  await pathFixture(async (apiRoot, root) => {
    const outDir = resolve(apiRoot, "dist-test"), backup = resolve(apiRoot, ".sandbox-state", randomUUID());
    await symlink(resolve(root, "absent-foreign-output"), outDir, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => emitter.assertJourneyRuntimeEmissionTargets(apiRoot, outDir, backup));
    await rm(outDir);
    await symlink(resolve(root, "absent-foreign-backup"), backup, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => emitter.assertJourneyRuntimeEmissionTargets(apiRoot, outDir, backup));
  });
});
