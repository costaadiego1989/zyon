import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { discoverFiscalTestFiles, runFiscalTestFiles, fiscalApiRoot } from "./fiscal-test-runner.js";

test("FISCAL-10/37 fiscal source discovery includes original folder and actual co-located receipt crypto checkout and authenticated webhook suites", () => {
  const files = discoverFiscalTestFiles();
  for (const expected of ["src/modules/fiscal/fiscal.module.integration.spec.ts", "src/modules/fiscal/infrastructure/fiscal-webhook-auth.spec.ts", "src/modules/fiscal/presentation/fiscal-webhooks.http.spec.ts", "src/modules/payment/infrastructure/fiscal-payment-receipt.spec.ts", "src/modules/payment/infrastructure/fiscal-crypto-receipt.spec.ts", "src/modules/checkout/application/use-cases/fiscal-completion.integration.spec.ts", "src/modules/storefront/infrastructure/tool-handlers/order.fiscal.spec.ts", "tests/fiscal-fixture.spec.ts", "tests/fiscal-schema.spec.ts", "tests/fiscal-runner-mjs.spec.mjs"])
    assert.ok(files.includes(expected), "actual fiscal suite discovered: " + expected);
  assert.ok(files.length >= 50);
  assert.equal(files.length, new Set(files).size);
  assert.ok(files.every(file => !file.includes("fixtures/") && !file.includes("dist/") && !file.includes("node_modules/")));
  assert.deepEqual(files, [...files].sort());
});

test("FISCAL-64 compiled runner preserves every prior import byte and registers actual fiscal source child", () => {
  const source = readFileSync(resolve(fiscalApiRoot, "src/test-runner.ts"), "utf8").replaceAll("\r\n", "\n");
  const marker = "// Fiscal source suites: retain every preceding legacy import unchanged.\n";
  const offset = source.indexOf(marker);
  assert.ok(offset > 0);
  const original = source.slice(0, offset);
  assert.equal(createHash("sha256").update(original).digest("hex"), "c83e6f046fd1179e9cc1acc2fa986615426fd3d12357f7f676aa186059ecef78");
  assert.equal((original.match(/^import /gm) ?? []).length, 537);
  assert.match(source.slice(offset), /runFiscalTestFiles\(discoverFiscalTestFiles\(\)\)/);
  assert.match(source.slice(offset), /assertFiscal\.equal\(result\.exitCode, 0/);
});

test("FISCAL-64 actual source child loads Nest constructor metadata and leaves no inherited Redis connection", async () => {
  const result = await runFiscalTestFiles(["tests/fixtures/fiscal-runner-success.fixture.ts"], { capture: true, timeoutMs: 30000, env: { REDIS_URL: "redis://unreachable.example:6379" } });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /fiscal_child_metadata_ok/);
  assert.match(result.stdout, /# pass 1/);
  assert.doesNotMatch(result.stdout + result.stderr, /unreachable\.example/);
});

test("FISCAL-64 genuine child assertion failure propagates a nonzero result with actual failure evidence", async () => {
  const result = await runFiscalTestFiles(["tests/fixtures/fiscal-runner-failure.fixture.ts"], { capture: true, timeoutMs: 30000 });
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /synthetic_expected_child_assertion_failure/);
  assert.match(result.stdout, /# fail 1/);
});

test("FISCAL-64 actual fiscal MJS source suites are discovered and executed through the same child loader", async () => {
  const files = discoverFiscalTestFiles().filter(file => file === "tests/fiscal-runner-mjs.spec.mjs");
  assert.equal(files.length, 1);
  const result = await runFiscalTestFiles(files, { capture: true, timeoutMs: 30000 });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /fiscal_mjs_source_child_executed/);
  assert.match(result.stdout, /# pass 1/);
});

test("FISCAL-64 fiscal source runner rejects missing remote legacy and query-override DSNs before starting a child", async () => {
  for (const databaseUrl of ["", "postgresql://remote.example/zyon_fiscal", "postgresql://localhost/aacp_test", "postgresql://localhost/zyon_fiscal?schema=anything", "postgresql://localhost/zyon_fiscal?host=remote.example"])
    await assert.rejects(runFiscalTestFiles(["tests/fixtures/fiscal-runner-success.fixture.ts"], { capture: true, env: { FISCAL_TEST_DATABASE_URL: databaseUrl } }), /fiscal_fixture_requires_isolated_local_database/);
});

test("FISCAL-64 scoped CI uses the strict local fiscal database and all source suites on Node22", () => {
  const workflow = readFileSync(resolve(fiscalApiRoot, "../../.github/workflows/fiscal-release.yml"), "utf8");
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /image: postgres:16-alpine/);
  assert.match(workflow, /POSTGRES_DB: zyon_fiscal/);
  assert.match(workflow, /FISCAL_TEST_DATABASE_URL: postgresql:\/\/fiscal:fiscal_ci_local_only@127\.0\.0\.1:5432\/zyon_fiscal\s/);
  assert.match(workflow, /node-version: '22'/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm --filter @zyon\/api build/);
  assert.match(workflow, /run: pnpm --filter @zyon\/api test:fiscal\s/);
  for (const required of ["test:payment", "test:widget-cross-sell-boundaries", "test:storefront-coupon-admission",
    "test:regression", "e2e/fiscal-unit.playwright.config.ts", "e2e/fiscal-current-orders.playwright.config.ts", "e2e/fiscal.playwright.config.ts"])
    assert.ok(workflow.includes(required), required);
  assert.match(workflow, /pnpm --filter @zyon\/storefront build/);
  assert.ok(workflow.indexOf("@zyon/widget-v2 build:app") < workflow.lastIndexOf("@zyon/widget-v2 build\n"));
  assert.doesNotMatch(workflow, /secrets\.|contents: write|\bdeploy\b|test-name-pattern/);
});
