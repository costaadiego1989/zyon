import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// Wiring contract only: actual SQL installation/inspection is covered by the
// trigger helper tests and owned PostgreSQL gates, not by this source check.
for (const file of ["storefront-journey-commerce.integration.mjs", "storefront-journey-owned-resources.mjs"]) {
  test(`${file} installs both deployed checkout guards after full schema and before owned markers`, async () => {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /import \{ installCheckoutSessionVersionTrigger \} from "\.\/checkout-session-version-trigger\.mjs";/);
    const schema = source.indexOf("await db.sql(diff.stdout);");
    const install = source.indexOf("await installCheckoutSessionVersionTrigger(db);");
    const markers = source.indexOf("CREATE TABLE synthetic_native_marker");
    assert.ok(schema >= 0 && install > schema && markers > install, "full_schema_then_actual_guards_then_markers_required");
    assert.equal([...source.matchAll(/await installCheckoutSessionVersionTrigger\(db\);/g)].length, 1);
  });
}

for (const [file, firstEffect] of [
  ["storefront-journey-bootstrap.integration.mjs", "await createDisposablePostgres("],
  ["storefront-journey-bootstrap.worker.mjs", "new PrismaClient("],
  ["storefront-journey-commerce.integration.mjs", "await createDisposablePostgres("],
  ["storefront-journey-owned-resources.mjs", "await createDisposablePostgres("],
  ["storefront-journey-owned-app.mjs", "const database = assertNativePrismaUrl("],
]) {
  test(`${file} requires fresh runtime-only provenance before resources or app setup`, async () => {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const preflight = source.indexOf("assertFreshJourneyRuntimeArtifacts();");
    const effect = source.indexOf(firstEffect);
    assert.ok(preflight >= 0 && effect > preflight, "runtime_provenance_before_effects_required");
    assert.equal(source.includes("assertFreshJourneyCompilation"), false, "waived_global_gate_must_not_remain_active");
    assert.match(source, /import \{ assertFreshJourneyRuntimeArtifacts(?:, journeyRuntimeArtifactEntries)? \} from "\.\/storefront-journey-compiled-artifact\.mjs";/);
  });
}
