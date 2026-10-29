import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { PrismaStorefrontWriteAdmissionRepository } from "./prisma-storefront-write-admission.repository.js";

const requestId = "c03a4307-00e4-4ce9-b069-1e58dc63185c";
const claimToken = "7b736a42-a58e-4a83-aa72-8b0010bc0978";
const scope = () => ({ merchantId: "merchant", conversationId: "conversation", cartId: "cart", principalId: "synthetic_principal" });
const input = () => ({ scope: scope(), intent: { version: 1 as const, message_id: "message", expected_revision: 0,
  command: { tool: "add_item_to_cart" as const, args: { variantId: "variant_not_persisted", quantity: 2 } } },
  fingerprint: { version: 1, bytes: new Uint8Array(32).fill(17) } });
const scopeRow = () => ({ ...scope(), protocolOwned: true, revision: 0n });
const existingRow = () => ({ ...scope(), requestId, messageId: "message", protocolVersion: 1, fingerprintVersion: 1,
  requestFingerprint: new Uint8Array(32).fill(17), commandKind: "add_item_to_cart", expectedRevision: 0n, claimGeneration: 1n, state: "processing" });
const claimRow = () => ({ requestId, claimToken, claimGeneration: 1n });
const claim = () => ({ requestId, claimToken, claimGeneration: 1 as const });
type Step = "begin" | "lock" | "scope" | "existing" | "active" | "insert" | "commit" | "update";
type Call = { step: Step; sql?: string; values?: unknown[] };

function fixture(options: { scope?: unknown; existing?: unknown; active?: unknown; inserted?: unknown; count?: unknown;
  failure?: Step; error?: Error; afterCallback?: () => Promise<void> } = {}) {
  const calls: Call[] = [];
  const error = options.error ?? new Error("synthetic_database_failure");
  const record = (step: Step, strings?: TemplateStringsArray, values?: unknown[]) => {
    calls.push({ step, ...(strings ? { sql: strings.join("?"), values } : {}) });
    if (options.failure === step) throw error;
  };
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("INSERT INTO storefront_write_requests")) { record("insert", strings, values); return Object.hasOwn(options, "inserted") ? options.inserted : [claimRow()]; }
    if (sql.includes("FROM storefront_execution_scopes")) { record("scope", strings, values); return Object.hasOwn(options, "scope") ? options.scope : [scopeRow()]; }
    if (sql.includes("AND message_id =")) { record("existing", strings, values); return Object.hasOwn(options, "existing") ? options.existing : []; }
    record("active", strings, values);
    return Object.hasOwn(options, "active") ? options.active : [];
  };
  const execute = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join("?").includes("UPDATE storefront_write_requests")) { record("update", strings, values); return Object.hasOwn(options, "count") ? options.count : 1; }
    record("lock", strings, values);
    return 1;
  };
  const tx = { $queryRaw: query, $executeRaw: execute };
  const prisma = {
    async $transaction<T>(callback: (client: typeof tx) => Promise<T>, configuration: unknown) {
      assert.deepEqual(configuration, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
      record("begin");
      const output = await callback(tx);
      await options.afterCallback?.();
      record("commit");
      return output;
    },
    $executeRaw: execute,
  } as unknown as PrismaClient;
  return { repository: new PrismaStorefrontWriteAdmissionRepository(prisma), calls, error };
}

test("admission uses the existing client and fixed lock/scope/key/lane/revision/insert transaction order", async () => {
  const f = fixture();
  assert.deepEqual(await f.repository.admit(input()), { kind: "claimed", claim: claim() });
  assert.deepEqual(f.calls.map(call => call.step), ["begin", "lock", "scope", "existing", "active", "insert", "commit"]);
  assert.match(f.calls[1].sql!, /pg_advisory_xact_lock\(hashtextextended\(\?,\s*0\)\)/);
  assert.deepEqual(f.calls[1].values, [JSON.stringify(["storefront-cart", "merchant", "cart"])]);
  assert.match(f.calls[2].sql!, /FOR UPDATE/i);
  assert.ok(f.calls.every(call => !call.sql?.includes("variant_not_persisted")));
  assert.ok(!f.calls.some(call => call.sql?.includes("canonicalMaterial")));
  assert.ok(!f.calls.flatMap(call => call.values ?? []).includes("variant_not_persisted"));
});

test("claimed is not observable before transaction commit resolution", async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ afterCallback: () => barrier });
  let settled = false;
  const pending = f.repository.admit(input()).then(result => { settled = true; return result; });
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
  assert.ok(f.calls.some(call => call.step === "insert"));
  assert.equal(settled, false);
  release();
  assert.deepEqual(await pending, { kind: "claimed", claim: claim() });
});

test("admission snapshots primitive scope/intent and opaque fingerprint bytes before asynchronous SQL", async () => {
  const f = fixture();
  const original = input();
  const pending = f.repository.admit(original);
  original.scope.merchantId = "changed_merchant";
  original.scope.cartId = "changed_cart";
  original.intent.message_id = "changed_message";
  original.intent.expected_revision = 9;
  original.fingerprint.version = 2;
  original.fingerprint.bytes.fill(99);
  await pending;
  const parameters = f.calls.flatMap(call => call.values ?? []);
  assert.ok(!parameters.some(value => typeof value === "string" && value.startsWith("changed_")));
  const bytes = parameters.find(value => value instanceof Uint8Array);
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes], Array(32).fill(17));
});

test("escaped Unicode and SQL-looking scope IDs remain values, not interpolated SQL", async () => {
  const original = input();
  original.scope.merchantId = "merchant'\"\\_😀";
  original.scope.cartId = "cart'); DELETE FROM merchants; --";
  const f = fixture({ scope: [{ ...scopeRow(), ...original.scope }] });
  await f.repository.admit(original);
  assert.deepEqual(f.calls.find(call => call.step === "lock")?.values, [JSON.stringify(["storefront-cart", original.scope.merchantId, original.scope.cartId])]);
  for (const call of f.calls) if (call.sql) {
    assert.ok(!call.sql.includes(original.scope.merchantId));
    assert.ok(!call.sql.includes(original.scope.cartId));
  }
});

for (const state of ["processing", "unknown"]) test(`same-key ${state} duplicates return a secret-free receipt before revision/lane checks`, async () => {
  const f = fixture({ scope: [{ ...scopeRow(), revision: 5n }], existing: [{ ...existingRow(), state }] });
  const output = await f.repository.admit(input());
  assert.deepEqual(output, { kind: "receipt_required", requestId, state });
  assert.deepEqual(f.calls.map(call => call.step), ["begin", "lock", "scope", "existing", "commit"]);
  assert.ok(!JSON.stringify(output).includes(claimToken));
  assert.ok(!JSON.stringify(output).includes("synthetic_principal"));
  assert.ok(!f.calls.find(call => call.step === "existing")?.sql?.includes("claim_token"));
});

for (const [name, patch] of [
  ["protocol", { protocolVersion: 2 }], ["revision", { expectedRevision: 1n }],
  ["fingerprint version", { fingerprintVersion: 2 }], ["fingerprint bytes", { requestFingerprint: new Uint8Array(32).fill(18) }],
  ["cart", { cartId: "foreign" }], ["principal", { principalId: "foreign" }], ["merchant", { merchantId: "foreign" }],
  ["conversation", { conversationId: "foreign" }], ["command kind", { commandKind: "other" }],
] as const) test(`same-key changed ${name} cannot claim or receive the original receipt`, async () => {
  const f = fixture({ existing: [{ ...existingRow(), ...patch }] });
  assert.deepEqual(await f.repository.admit(input()), { kind: "identity_conflict" });
  assert.ok(!f.calls.some(call => ["active", "insert"].includes(call.step)));
});

test("changed command arguments supplied with a distinct trusted fingerprint conflict without raw-argument persistence", async () => {
  const f = fixture({ existing: [existingRow()] });
  const changed = input();
  changed.intent.command.args.quantity = 3;
  changed.fingerprint.bytes.fill(18);
  assert.deepEqual(await f.repository.admit(changed), { kind: "identity_conflict" });
  assert.ok(!f.calls.some(call => call.step === "insert"));
});

for (const state of ["processing", "unknown"]) test(`${state} unresolved lane blocks a different message without another insert`, async () => {
  const f = fixture({ active: [{ ...existingRow(), messageId: "other", state }] });
  assert.deepEqual(await f.repository.admit(input()), { kind: "lane_blocked" });
  assert.ok(!f.calls.some(call => call.step === "insert"));
});

test("empty lane with a different current revision gives revision_conflict", async () => {
  const f = fixture({ scope: [{ ...scopeRow(), revision: 1n }] });
  assert.deepEqual(await f.repository.admit(input()), { kind: "revision_conflict" });
  assert.ok(!f.calls.some(call => call.step === "insert"));
});

for (const [name, row] of [
  ["missing", undefined], ["merchant", { ...scopeRow(), merchantId: "foreign" }],
  ["conversation", { ...scopeRow(), conversationId: "foreign" }], ["cart", { ...scopeRow(), cartId: "foreign" }],
  ["principal", { ...scopeRow(), principalId: "foreign" }], ["protocol ownership", { ...scopeRow(), protocolOwned: false }],
] as const) test(`preprovisioned scope ${name} returns scope_unavailable without creating any anchor/request`, async () => {
  const f = fixture({ scope: row ? [row] : [] });
  assert.deepEqual(await f.repository.admit(input()), { kind: "scope_unavailable" });
  assert.deepEqual(f.calls.map(call => call.step), ["begin", "lock", "scope", "commit"]);
});

for (const step of ["begin", "lock", "scope", "existing", "active", "insert", "commit"] as const) test(`${step} database failure propagates the same error without transaction or admission retry`, async () => {
  const f = fixture({ failure: step });
  await assert.rejects(f.repository.admit(input()), error => error === f.error);
  assert.equal(f.calls.filter(call => call.step === "begin").length, 1);
  assert.equal(f.calls.filter(call => call.step === step).length, 1);
});

for (const [name, options] of [
  ["scope shape", { scope: [{ ...scopeRow(), privateField: "secret" }] }],
  ["revision overflow", { scope: [{ ...scopeRow(), revision: 9007199254740992n }] }],
  ["duplicate scope rows", { scope: [scopeRow(), scopeRow()] }],
  ["terminal request", { existing: [{ ...existingRow(), state: "completed" }] }],
  ["request extra secret", { existing: [{ ...existingRow(), claimToken }] }],
  ["null existing result", { existing: null }],
  ["null active result", { active: null }],
  ["multiple same-key rows", { existing: [existingRow(), existingRow()] }],
  ["multiple active rows", { active: [existingRow(), existingRow()] }],
  ["active foreign scope", { active: [{ ...existingRow(), principalId: "foreign" }] }],
  ["short stored fingerprint", { existing: [{ ...existingRow(), requestFingerprint: new Uint8Array(15) }] }],
  ["large stored fingerprint", { existing: [{ ...existingRow(), requestFingerprint: new Uint8Array(129) }] }],
  ["stored revision overflow", { existing: [{ ...existingRow(), expectedRevision: 9007199254740992n }] }],
  ["stored negative revision", { existing: [{ ...existingRow(), expectedRevision: -1n }] }],
  ["stored generation", { existing: [{ ...existingRow(), claimGeneration: 2n }] }],
  ["stored invalid UUID", { existing: [{ ...existingRow(), requestId: "invalid" }] }],
  ["empty insert", { inserted: [] }], ["multiple insert", { inserted: [claimRow(), claimRow()] }],
  ["invalid claim token", { inserted: [{ ...claimRow(), claimToken: "not-a-uuid" }] }],
  ["inserted generation", { inserted: [{ ...claimRow(), claimGeneration: 2n }] }],
] as const) test(`malformed ${name} DB projection fails closed without successful commit or retry`, async () => {
  const f = fixture(options);
  await assert.rejects(f.repository.admit(input()));
  assert.ok(!f.calls.some(call => call.step === "commit"));
  assert.equal(f.calls.filter(call => call.step === "begin").length, 1);
});

test("malformed admission inputs, NUL and ill-formed Unicode are rejected before any transaction", async () => {
  for (const value of [null, { ...input(), extra: true }, { ...input(), scope: { ...scope(), cartId: "bad\u0000cart" } },
    { ...input(), scope: { ...scope(), merchantId: "bad\ud800" } }, { ...input(), fingerprint: { version: 1, bytes: new Uint8Array(15) } }]) {
    const f = fixture();
    await assert.rejects(f.repository.admit(value as ReturnType<typeof input>));
    assert.deepEqual(f.calls, []);
  }
});

for (const count of [0, 1]) test(`markUnknown count ${count} uses a scoped token/generation/processing CAS`, async () => {
  const f = fixture({ count });
  assert.deepEqual(await f.repository.markUnknown({ scope: scope(), claim: claim() }), { kind: count ? "marked_unknown" : "not_current" });
  assert.deepEqual(f.calls.map(call => call.step), ["update"]);
  const update = f.calls[0];
  assert.match(update.sql!, /status\s*=\s*'processing'/);
  assert.match(update.sql!, /status\s*=\s*'unknown'/);
  for (const column of ["merchant_id", "conversation_id", "cart_id", "principal_id", "id", "claim_token", "claim_generation"]) assert.ok(update.sql!.includes(column));
  for (const value of ["merchant", "conversation", "cart", "synthetic_principal", requestId, claimToken]) assert.ok(update.values!.includes(value));
});

for (const count of [-1, 2, "1", null, NaN]) test(`markUnknown rejects invalid update count ${String(count)} without retries`, async () => {
  const f = fixture({ count });
  await assert.rejects(f.repository.markUnknown({ scope: scope(), claim: claim() }));
  assert.equal(f.calls.length, 1);
});

test("markUnknown database failure preserves uncertainty and has no compensating update or retry", async () => {
  const f = fixture({ failure: "update" });
  await assert.rejects(f.repository.markUnknown({ scope: scope(), claim: claim() }), error => error === f.error);
  assert.equal(f.calls.length, 1);
});

test("markUnknown detaches caller-owned scope/claim before returning a pending SQL operation", async () => {
  const f = fixture();
  const original = { scope: scope(), claim: claim() };
  const pending = f.repository.markUnknown(original);
  original.scope.merchantId = "changed_merchant";
  original.claim.claimToken = "7ac9ac8d-e74f-4851-9ee0-1d50bda2ec03";
  await pending;
  const values = f.calls[0].values!;
  assert.ok(values.includes("merchant"));
  assert.ok(values.includes(claimToken));
  assert.ok(!values.includes("changed_merchant"));
  assert.ok(!values.includes(original.claim.claimToken));
});

test("markUnknown rejects malformed scope/claim before SQL", async () => {
  const f = fixture();
  await assert.rejects(f.repository.markUnknown({ scope: scope(), claim: { ...claim(), claimGeneration: 2 } } as never));
  assert.deepEqual(f.calls, []);
});

