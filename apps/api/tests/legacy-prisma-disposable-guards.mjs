import assert from "node:assert/strict";
import { assertNativePrismaUrl, nativePrismaWorkerEnvironment } from "./native-prisma-admission-guards.mjs";

const suites = Object.freeze({
  settings: Object.freeze({ name: "settings", spec: "../src/modules/checkout-settings/infrastructure/prisma-checkout-settings.repository.int-spec.ts", fixture: "./fixtures/legacy-prisma/settings.sql" }),
  m2m: Object.freeze({ name: "m2m", spec: "../src/modules/negotiation/__tests__/m2m-session.int-spec.ts", fixture: "./fixtures/legacy-prisma/m2m.sql" }),
  intervention: Object.freeze({ name: "intervention", spec: "../src/modules/checkout/infrastructure/prisma-intervention-ledger.repository.int-spec.ts", fixture: "./fixtures/legacy-prisma/intervention.sql" }),
  "buyer-history": Object.freeze({ name: "buyer-history", spec: "../src/modules/buyer-purchase-history/infrastructure/prisma-buyer-purchase-history.repository.int-spec.ts", fixture: "./fixtures/legacy-prisma/buyer-history.sql" }),
  negotiation: Object.freeze({ name: "negotiation", spec: "../src/modules/negotiation/__tests__/negotiation-attempt.int-spec.ts", fixture: "./fixtures/legacy-prisma/negotiation.sql" }),
  protocol: Object.freeze({ name: "protocol", spec: "../src/modules/embed/__tests__/protocol-session.int-spec.ts", fixture: "./fixtures/legacy-prisma/protocol.sql" }),
  recovery: Object.freeze({ name: "recovery", spec: "../src/modules/cart-recovery/__tests__/recovery-attempt.int-spec.ts", fixture: "./fixtures/legacy-prisma/recovery.sql" }),
  "intent-memory": Object.freeze({ name: "intent-memory", spec: "../src/modules/intent-memory/__tests__/intent-memory.int-spec.ts", fixture: "./fixtures/legacy-prisma/intent-memory.sql" }),
  "auth-merchant": Object.freeze({ name: "auth-merchant", spec: "../src/modules/auth/presentation/auth-merchant.prisma-e2e-spec.ts", fixture: "./fixtures/legacy-prisma/auth.sql" }),
  "auth-me": Object.freeze({ name: "auth-me", spec: "../src/modules/auth/presentation/auth-me.prisma-e2e-spec.ts", fixture: "./fixtures/legacy-prisma/auth.sql" }),
  "agent-rules": Object.freeze({ name: "agent-rules", spec: "../src/modules/agent-rules/presentation/http/agent-rules.prisma-e2e-spec.ts", fixture: "./fixtures/legacy-prisma/auth.sql" }),
  commerce: Object.freeze({ name: "commerce", spec: "../src/modules/commerce/infrastructure/prisma-commerce.repository.int-spec.ts", fixture: "./fixtures/legacy-prisma/commerce.sql" }),
  revenue: Object.freeze({ name: "revenue", spec: "../src/modules/revenue-lift/__tests__/revenue-lift.int-spec.ts", fixture: "./fixtures/legacy-prisma/revenue.sql" }),
  "revenue-component": Object.freeze({ name: "revenue-component", spec: "../src/modules/revenue-lift/__tests__/revenue-lift.e2e.spec.ts", fixture: "./fixtures/legacy-prisma/revenue.sql" }),
  "checkout-repo": Object.freeze({ name: "checkout-repo", spec: "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.int-spec.ts", fixture: "./fixtures/legacy-prisma/checkout-payment.sql" }),
  "checkout-controller": Object.freeze({ name: "checkout-controller", spec: "../src/modules/checkout/presentation/http/checkout.controller.prisma-e2e-spec.ts", fixture: "./fixtures/legacy-prisma/checkout-payment.sql" }),
  payment: Object.freeze({ name: "payment", spec: "../src/modules/payment/infrastructure/prisma-payment.repository.int-spec.ts", fixture: "./fixtures/legacy-prisma/checkout-payment.sql" }),
});

export function legacyPrismaSelection(args) {
  assert.ok(Array.isArray(args) && args.every(arg => typeof arg === "string"));
  const selector = args.find(arg => arg.startsWith("--suite="));
  const name = selector?.slice("--suite=".length);
  assert.ok(Object.hasOwn(suites, name ?? ""), "allowlisted_legacy_suite_required");
  const probeMissingFixture = args.includes("--probe-missing-fixture");
  assert.deepEqual([...args].sort(), ["--local-disposable", "--prisma-loopback-exec", `--suite=${name}`, ...(probeMissingFixture ? ["--probe-missing-fixture"] : [])].sort(), "explicit_disposable_flags_required");
  return { ...suites[name], probeMissingFixture };
}

export function assertLegacySyntheticIdentity(url, runId, rows) {
  const parsed = assertNativePrismaUrl(url);
  assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(parsed.searchParams.get("application_name"), `aacp_write_native_${runId}`);
  assert.deepEqual(rows, [{ database: "storefront_synthetic", run_id: runId }], "owned_synthetic_marker_required");
}

export const legacyPrismaTestEnvironment = nativePrismaWorkerEnvironment;
