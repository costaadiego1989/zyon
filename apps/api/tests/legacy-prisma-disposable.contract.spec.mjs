import test from "node:test";
import assert from "node:assert/strict";
import { legacyPrismaSelection, assertLegacySyntheticIdentity, legacyPrismaTestEnvironment } from "./legacy-prisma-disposable-guards.mjs";

const runId = "12345678-1234-1234-1234-123456789abc";
const url = `postgresql://postgres@127.0.0.1:54321/storefront_synthetic?schema=public&connection_limit=24&connect_timeout=15&pool_timeout=15&application_name=aacp_write_native_${runId}`;
test("only explicit disposable flags and exact test names are accepted", () => {
  assert.equal(legacyPrismaSelection(["--local-disposable", "--prisma-loopback-exec", "--suite=settings"]).name, "settings");
  assert.equal(legacyPrismaSelection(["--suite=m2m", "--prisma-loopback-exec", "--local-disposable"]).name, "m2m");
  assert.equal(legacyPrismaSelection(["--suite=m2m", "--prisma-loopback-exec", "--local-disposable", "--probe-missing-fixture"]).probeMissingFixture, true);
  for (const args of [[], ["--suite=settings"], ["--local-disposable", "--prisma-loopback-exec", "--suite=../anything"],
    ["--local-disposable", "--prisma-loopback-exec", "--suite=settings", "--env-file=.env"],
    ["--local-disposable", "--prisma-loopback-exec", "--suite=settings", "--suite=settings"]]) {
    assert.throws(() => legacyPrismaSelection(args));
  }
});
test("marker database and complete native URL identity must agree", () => {
  assert.doesNotThrow(() => assertLegacySyntheticIdentity(url, runId, [{ database: "storefront_synthetic", run_id: runId }]));
  for (const rows of [[], [{ database: "production", run_id: runId }], [{ database: "storefront_synthetic", run_id: "foreign" }],
    [{ database: "storefront_synthetic", run_id: runId }, { database: "storefront_synthetic", run_id: runId }]]) {
    assert.throws(() => assertLegacySyntheticIdentity(url, runId, rows));
  }
  for (const bad of [url.replace("127.0.0.1", "remote.example"), url.replace(runId, "foreign"), url + "&sslmode=require"]) {
    assert.throws(() => assertLegacySyntheticIdentity(bad, runId, [{ database: "storefront_synthetic", run_id: runId }]));
  }
});
test("worker environment strips ambient database provider and node hooks", () => {
  const clean = legacyPrismaTestEnvironment({ PATH: "synthetic-path", DATABASE_URL: "NEVER_USE", DIRECT_URL: "NEVER_USE",
    DEEPSEEK_API_KEY: "NEVER_USE", NODE_OPTIONS: "NEVER_USE", AACP_RUN_PRISMA_TESTS: "1", READY_PROD_TEST_PRISMA_CLIENT: "NEVER_USE" });
  assert.equal(clean.PATH, "synthetic-path");
  assert.equal(clean.NODE_ENV, "test");
  for (const key of ["DATABASE_URL", "DIRECT_URL", "DEEPSEEK_API_KEY", "NODE_OPTIONS", "AACP_RUN_PRISMA_TESTS", "READY_PROD_TEST_PRISMA_CLIENT"]) {
    assert.equal(clean[key], undefined);
  }
});

for (const [name, spec, fixture = name] of [
  ["intervention", "checkout/infrastructure/prisma-intervention-ledger.repository.int-spec.ts"],
  ["buyer-history", "buyer-purchase-history/infrastructure/prisma-buyer-purchase-history.repository.int-spec.ts"],
  ["negotiation", "negotiation/__tests__/negotiation-attempt.int-spec.ts"],
  ["protocol", "embed/__tests__/protocol-session.int-spec.ts"],
  ["recovery", "cart-recovery/__tests__/recovery-attempt.int-spec.ts"],
  ["intent-memory", "intent-memory/__tests__/intent-memory.int-spec.ts"],
  ["auth-merchant", "auth/presentation/auth-merchant.prisma-e2e-spec.ts", "auth"],
  ["agent-rules", "agent-rules/presentation/http/agent-rules.prisma-e2e-spec.ts", "auth"],
  ["commerce", "commerce/infrastructure/prisma-commerce.repository.int-spec.ts"],
  ["revenue", "revenue-lift/__tests__/revenue-lift.int-spec.ts"],
  ["revenue-component", "revenue-lift/__tests__/revenue-lift.e2e.spec.ts", "revenue"],
  ["checkout-repo", "checkout/infrastructure/prisma/prisma-checkout.repository.int-spec.ts", "checkout-payment"],
  ["checkout-controller", "checkout/presentation/http/checkout.controller.prisma-e2e-spec.ts", "checkout-payment"],
  ["payment", "payment/infrastructure/prisma-payment.repository.int-spec.ts", "checkout-payment"],
]) {
  test(`audited exact legacy suite ${name} resolves only its fixed source and synthetic fixture`, () => {
    const selected = legacyPrismaSelection(["--local-disposable", "--prisma-loopback-exec", `--suite=${name}`]);
    assert.equal(selected.name, name);
    assert.equal(selected.fixture, `./fixtures/legacy-prisma/${fixture}.sql`);
    assert.equal(selected.spec, `../src/modules/${spec}`);
    assert.equal(selected.probeMissingFixture, false);
    for (const arg of ["--env-file=.env", "--url=postgresql://remote", "--suite=settings"]) {
      assert.throws(() => legacyPrismaSelection(["--local-disposable", "--prisma-loopback-exec", `--suite=${name}`, arg]));
    }
  });
}
