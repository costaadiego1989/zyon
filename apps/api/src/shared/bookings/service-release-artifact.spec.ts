import assert from "node:assert/strict";
import test from "node:test";
import { ImmutableServiceReleaseArtifact, measureServiceReleaseRuntime } from "./service-release-artifact.js";
import { SERVICE_RELEASE_WRITERS } from "./service-release-manifest.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import { ownedServiceReleaseFixtureData, syntheticServiceReleaseRuntime } from "../../../tests/service-release-fixture-data.js";

test("T94 immutable datasource provider", async t => {
  await t.test("missing asset is unavailable and does not require measuring an unrelated payload", () => {
    const artifact = new ImmutableServiceReleaseArtifact({ readManifest: () => undefined, measureRuntime: () => assert.fail("missing data never authorizes readiness") });
    assert.deepEqual(artifact.read(), { kind: "unavailable", blocker: "release_manifest_missing" });
  });
  await t.test("read failures and measurement failures expose only blocker codes", () => {
    const missing = new ImmutableServiceReleaseArtifact({ readManifest: () => { throw Object.assign(new Error("private/path"), { code: "ENOENT" }); }, measureRuntime: syntheticServiceReleaseRuntime });
    assert.deepEqual(missing.read(), { kind: "unavailable", blocker: "release_manifest_missing" });
    const invalid = new ImmutableServiceReleaseArtifact({ readManifest: () => { throw Error("private/path"); }, measureRuntime: syntheticServiceReleaseRuntime });
    assert.deepEqual(invalid.read(), { kind: "unavailable", blocker: "release_manifest_invalid" });
    const changed = new ImmutableServiceReleaseArtifact({ readManifest: () => ({}), measureRuntime: () => { throw Error("private/path"); } });
    assert.deepEqual(changed.read(), { kind: "unavailable", blocker: "release_payload_changed" });
  });
  await t.test("private synthetic bytes traverse the real verifier and are frozen after the initial read", () => {
    const fixture = ownedServiceReleaseFixtureData(syntheticServiceReleaseRuntime()); let reads = 0;
    const provider = new ImmutableServiceReleaseArtifact({ readManifest: () => { reads++; return fixture.source.readManifest(); }, measureRuntime: fixture.source.measureRuntime });
    const first = provider.read(); assert.equal(first.kind, "verified"); fixture.manifest.sourceRevision = "f".repeat(40);
    assert.equal(provider.read(), first); assert.equal(reads, 1); assert.ok(Object.isFrozen(first));
    if (first.kind !== "verified") assert.fail("verified precondition required"); assert.ok(Object.isFrozen(first.manifest.writers));
  });
  await t.test("a changed measured runtime is rejected by the same provider instead of a ready boolean", () => {
    const fixture = ownedServiceReleaseFixtureData(syntheticServiceReleaseRuntime());
    const provider = new ImmutableServiceReleaseArtifact({ readManifest: fixture.source.readManifest,
      measureRuntime: () => ({ ...fixture.source.measureRuntime(), apiPayloadSha256: "f".repeat(64) }) });
    assert.deepEqual(provider.read(), { kind: "unavailable", blocker: "release_payload_changed" });
  });
});

test("T94 productive module workers change the measured source and emitted payload digests", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "zyon-service-module-inputs-"));
  const write = (path: string, value: string) => {
    const file = resolve(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value);
  };
  try {
    const api = resolve(directory, "apps/api");
    for (const path of ["package.json", "tsconfig.base.json", "apps/api/tsconfig.json", "apps/api/tsconfig.build.json", "packages/worker-fixture/package.json",
      "apps/api/prisma.config.ts", "apps/api/prisma.company-directory.config.ts"])
      write(path, "{}");
    write("apps/api/package.json", JSON.stringify({ dependencies: { "@zyon/worker-fixture": "workspace:*" } }));
    write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    write("apps/api/prisma/schema.prisma", "// isolated measurement fixture\n");
    write("apps/api/prisma/company-directory.prisma", "// isolated company directory measurement fixture\n");
    write("apps/api/prisma/deploy-migrations/fixture/migration.sql", "SELECT 1;\n");
    write("apps/api/src/main.ts", "export const fixture = 1;\n");
    write("packages/worker-fixture/src/main.ts", "export const fixture = 1;\n");
    write("packages/worker-fixture/dist/main.js", "export const fixture = 1;\n");
    write("apps/api/dist/app.module.js", "export const fixture = 1;\n");
    mkdirSync(resolve(api, "assets"), { recursive: true });
    for (const writer of SERVICE_RELEASE_WRITERS) write(writer.emittedPath, "export const writer = 1;\n");
    for (const suffix of ["js", "jsx", "mjs", "cjs"]) {
      const source = "apps/api/src/worker." + suffix, emitted = "packages/worker-fixture/dist/worker." + suffix;
      write(source, "// original source worker\n"); write(emitted, "// original emitted worker\n");
      const before = measureServiceReleaseRuntime(api, "a".repeat(40));
      write(source, "// changed source worker\n");
      const sourceChanged = measureServiceReleaseRuntime(api, "a".repeat(40));
      assert.notEqual(sourceChanged.sourceInputSha256, before.sourceInputSha256, suffix + " source bytes must participate");
      assert.equal(sourceChanged.apiPayloadSha256, before.apiPayloadSha256);
      write(emitted, "// changed emitted worker\n");
      const outputChanged = measureServiceReleaseRuntime(api, "a".repeat(40));
      assert.notEqual(outputChanged.apiPayloadSha256, sourceChanged.apiPayloadSha256, suffix + " emitted bytes must participate");
      assert.equal(outputChanged.sourceInputSha256, sourceChanged.sourceInputSha256);
    }
    for (const path of ["apps/api/prisma.config.ts", "apps/api/prisma/schema.prisma", "apps/api/prisma.company-directory.config.ts", "apps/api/prisma/company-directory.prisma"]) {
      const before = measureServiceReleaseRuntime(api, "a".repeat(40));
      write(path, "// changed generator input " + path + "\n");
      const changed = measureServiceReleaseRuntime(api, "a".repeat(40));
      assert.notEqual(changed.sourceInputSha256, before.sourceInputSha256, path + " must bind the source identity");
      assert.notEqual(changed.apiPayloadSha256, before.apiPayloadSha256, path + " must bind the runtime payload identity");
    }
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("zyon-service-module-inputs-"));
    rmSync(directory, { recursive: true });
  }
});
