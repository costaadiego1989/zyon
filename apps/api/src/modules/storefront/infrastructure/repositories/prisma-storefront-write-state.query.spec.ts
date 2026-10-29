import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaStorefrontWriteStateQuery } from "./prisma-storefront-write-state.query.js";

const scope = () => ({ merchantId: "merchant", conversationId: "conversation", cartId: "session", principalId: "principal" });
const requestId = "56f51c75-e1d5-4a84-9031-e616927707a0", effectId = "a5537938-7496-4ea4-94b4-ec872a418337";
const effect = () => ({ ...scope(), requestId, effectId, claimGeneration: 1, beforeRevision: 0, afterRevision: 1 });
const request = () => ({ ...scope(), requestId, messageId: "message", protocolVersion: 1, commandKind: "add_item_to_cart",
  expectedRevision: 0, claimGeneration: 1, state: "processing", effect: null as ReturnType<typeof effect> | null });
const row = () => ({ ...scope(), protocolOwned: true, revision: 0n, request: null as ReturnType<typeof request> | null });
type Call = { sql: string; values: unknown[] };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function fixture(rows: unknown = [row()], options: { failure?: { reason: unknown }; beforeResult?: Promise<void> } = {}) {
  const calls: Call[] = [];
  // Strict root-client fake: business delegates, raw writes, transactions and
  // lifecycle methods are unavailable. This does NOT prove native SQL/MVCC.
  const prisma = new Proxy({ async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
    calls.push({ sql: parts.join("?"), values }); await options.beforeResult;
    if (options.failure) throw options.failure.reason;
    return structuredClone(rows);
  } }, { get(target, key) {
    if (key !== "$queryRaw") assert.fail(`unexpected_root_client_access_${String(key)}`);
    return target.$queryRaw;
  } });
  return { query: new PrismaStorefrontWriteStateQuery(prisma as unknown as PrismaClient), calls,
    read: () => new PrismaStorefrontWriteStateQuery(prisma as unknown as PrismaClient).read({ scope: scope() }) };
}
test("missing scope is observed without defaults, transactions or business reads", async () => {
  let calls = 0;
  const prisma = { async $queryRaw() { calls++; return []; } };
  const query = new PrismaStorefrontWriteStateQuery(prisma as unknown as PrismaClient);
  assert.deepEqual(await query.read({ scope: scope() }), { kind: "scope_unavailable" });
  assert.equal(calls, 1);
});

test("one parameterized LEFT JOIN SELECT reads only ledger state, with no locks/TTL/business dependency", async () => {
  const f = fixture(); assert.deepEqual(await f.read(), { kind: "state", revision: 0, request: null });
  assert.equal(f.calls.length, 1); const { sql, values } = f.calls[0];
  assert.match(sql.trimStart(), /^SELECT\b/i); assert.equal((sql.match(/LEFT JOIN/gi) ?? []).length, 2);
  for (const table of ["storefront_execution_scopes", "storefront_write_requests", "storefront_local_cart_effects"]) assert.ok(sql.includes(table));
  for (const value of Object.values(scope())) assert.ok(values.includes(value));
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|BEGIN|COMMIT|FOR\s+SHARE)\b|pg_advisory|\bstorefront_carts\b|\bproduct_variants\b|\bmerchant_rules\b|expires_at|updated_at/i.test(sql));
  assert.ok(!/claim_token|claimToken|fingerprint|request_fingerprint|raw_args|unit_price|cost_in_cents|created_at/i.test(sql));
  for (const column of ["merchant_id", "conversation_id", "cart_id", "principal_id"]) {
    const where = sql.slice(sql.lastIndexOf("WHERE")); assert.ok(where.includes(column));
  }
});
for (const field of ["merchantId", "conversationId", "cartId", "principalId"] as const) test(`foreign ${field} returns only unavailable, never request/effect existence`, async () => {
  const foreign = row(); foreign[field] = "foreign"; foreign.revision = 1n; foreign.request = { ...request(), effect: effect() };
  const f = fixture([foreign]); assert.deepEqual(await f.read(), { kind: "scope_unavailable" }); assert.equal(f.calls.length, 1);
});
test("not-owned scope is unavailable without requesting ownership or creating defaults", async () => {
  const value = row(); value.protocolOwned = false;
  assert.deepEqual(await fixture([value]).read(), { kind: "scope_unavailable" });
});
for (const state of ["processing", "unknown"]) test(`${state} without a reference remains unresolved, not proof of zero effect`, async () => {
  const value = row(); value.request = { ...request(), state };
  assert.deepEqual(await fixture([value]).read(), { kind: "state", revision: 0,
    request: { requestId, messageId: "message", protocolVersion: 1, expectedRevision: 0, state, effect: null } });
});
for (const state of ["processing", "unknown"]) test(`${state} with immutable reference exposes minimal observation without completing lane`, async () => {
  const value = row(); value.revision = 1n; value.request = { ...request(), state, effect: effect() };
  const f = fixture([value]), output = await f.read();
  assert.deepEqual(output, { kind: "state", revision: 1, request: { requestId, messageId: "message", protocolVersion: 1, expectedRevision: 0,
    state, effect: { effectId, revision: 1 } } });
  assert.equal(f.calls.length, 1);
  const serialized = JSON.stringify(output);
  for (const forbidden of ["claimGeneration", "claimToken", "fingerprint", "merchantId", "cartId", "principalId", "completed", "cartRowId"]) assert.ok(!serialized.includes(forbidden));
});
test("reference remains observable independently of an expired/deleted cart or unavailable catalog", async () => {
  const value = row(); value.revision = 1n; value.request = { ...request(), effect: effect() };
  const f = fixture([value]); const result = await f.read(); assert.equal(result.kind, "state"); assert.equal(f.calls.length, 1);
  // No cart/catalog delegate exists in this fake, so any read-through or TTL
  // renewal would fail. Actual expired-cart/MVCC behavior needs native proof.
});
test("anchor may have a later valid revision than the observed request effect", async () => {
  const value = row(); value.revision = 5n; value.request = { ...request(), effect: effect() };
  assert.deepEqual(await fixture([value]).read(), { kind: "state", revision: 5,
    request: { requestId, messageId: "message", protocolVersion: 1, expectedRevision: 0, state: "processing", effect: { effectId, revision: 1 } } });
});
for (const part of ["request", "effect"] as const) for (const field of ["merchantId", "conversationId", "cartId", "principalId"] as const) {
  test(`joined ${part} ${field} mismatch is corruption, never another tenant's observation`, async () => {
    const value = row(); value.revision = 1n; value.request = { ...request(), effect: effect() };
    if (part === "request") value.request[field] = "foreign"; else value.request.effect![field] = "foreign";
    const f = fixture([value]); await assert.rejects(f.read()); assert.equal(f.calls.length, 1);
  });
}
for (const patch of [{ requestId: effectId }, { beforeRevision: 1 }, { afterRevision: 2 }, { claimGeneration: 2 },
  { afterRevision: 0 }, { afterRevision: Number.MAX_SAFE_INTEGER + 1 }, { beforeRevision: 0n }, { claimToken: "private" },
  { effectId: null }, { cartRowId: "forbidden" }]) test(`effect projection coherence rejects ${Object.keys(patch)[0]}:${String(Object.values(patch)[0])}`, async () => {
  const value = row(); value.revision = 1n; value.request = { ...request(), effect: { ...effect(), ...patch } as never };
  await assert.rejects(fixture([value]).read());
});
for (const patch of [{ expectedRevision: 1 }, { claimGeneration: 2 }, { claimGeneration: 1n }, { commandKind: "other" },
  { protocolVersion: 0 }, { protocolVersion: 32768 }, { requestId: "bad" }, { messageId: "x\0y" }, { messageId: "\ud800" },
  { expectedRevision: 0n }, { expectedRevision: "0" }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
  { state: "completed" }, { state: "rejected" }, { state: "reconciled" }, { claimToken: "private" }, { fingerprint: "private" },
  { effect: undefined }, { effect: {} }]) test(`unsupported request projection rejects ${Object.keys(patch)[0]}:${String(Object.values(patch)[0])}`, async () => {
  const value = row(); value.request = { ...request(), ...patch } as never;
  await assert.rejects(fixture([value]).read());
});
for (const revision of [-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 0, "0", null]) test(`anchor revision must be a bounded raw BIGINT (${String(revision)})`, async () => {
  await assert.rejects(fixture([{ ...row(), revision }]).read());
});
for (const rows of [null, {}, [row(), row()], [{ ...row(), extra: true }], [{ ...row(), request: undefined }],
  [{ ...row(), request: [] }], [{ ...row(), request: { effect: effect() } }], [{ ...row(), request: null, effect: effect() }]]) {
  test(`malformed row/null-join/cardinality never becomes empty fallback ${JSON.stringify(rows, (_, value) => typeof value === "bigint" ? String(value) : value).slice(0, 80)}`, async () => {
    const f = fixture(rows); await assert.rejects(f.read()); assert.equal(f.calls.length, 1);
  });
}
test("effect reference ahead of anchor is incoherent and cannot escape", async () => {
  const value = row(); value.request = { ...request(), effect: effect() };
  await assert.rejects(fixture([value]).read());
});
test("anchor changed without request evidence is not inferred to be a completed effect", async () => {
  const value = row(); value.revision = 1n; value.request = request();
  await assert.rejects(fixture([value]).read());
});
test("safe numeric boundary preserves MAX_SAFE_INTEGER without bigint JSON leakage", async () => {
  const value = row(); value.revision = BigInt(Number.MAX_SAFE_INTEGER);
  value.request = { ...request(), expectedRevision: Number.MAX_SAFE_INTEGER - 1,
    effect: { ...effect(), beforeRevision: Number.MAX_SAFE_INTEGER - 1, afterRevision: Number.MAX_SAFE_INTEGER } };
  const result = await fixture([value]).read();
  assert.equal(result.kind, "state"); assert.doesNotThrow(() => JSON.stringify(result));
  if (result.kind === "state") assert.equal(result.request?.effect?.revision, Number.MAX_SAFE_INTEGER);
});
for (const reason of [new Error("synthetic-private-database-error"), undefined, null, false, 0, ""]) test(`query failure propagates exactly once (${String(reason)})`, async () => {
  const f = fixture([], { failure: { reason } }); await assert.rejects(f.read(), error => Object.is(error, reason)); assert.equal(f.calls.length, 1);
});
for (const input of [null, {}, { scope: { ...scope(), extra: true } }, { scope: { ...scope(), principalId: "x\0y" } },
  { scope: { ...scope(), cartId: "\ud800" } }, { scope: scope(), fingerprint: new Uint8Array(32) }, { scope: scope(), claimToken: requestId }]) {
  test(`invalid input fails before SQL ${JSON.stringify(input)}`, async () => {
    const f = fixture(); await assert.rejects(f.query.read(input as never)); assert.deepEqual(f.calls, []);
  });
}
test("input scope is snapshotted before awaiting the single result", async () => {
  const gate = deferred(), f = fixture([row()], { beforeResult: gate.promise }), input = { scope: scope() };
  const pending = f.query.read(input); input.scope.merchantId = "changed"; input.scope.cartId = "changed"; gate.resolve();
  assert.deepEqual(await pending, { kind: "state", revision: 0, request: null });
  assert.ok(!f.calls[0].values.includes("changed")); assert.equal(f.calls.length, 1);
});
test("SQL-looking/Unicode scope remains bound as values, never interpolated source", async () => {
  const bound = { ...scope(), merchantId: 'merchant"; DROP TABLE ledger;--', cartId: ' sessão 😀 \\" ' };
  const f = fixture([{ ...row(), ...bound }]);
  assert.deepEqual(await f.query.read({ scope: bound }), { kind: "state", revision: 0, request: null });
  for (const value of Object.values(bound)) assert.ok(f.calls[0].values.includes(value));
  for (const value of [bound.merchantId, bound.cartId]) assert.ok(!f.calls[0].sql.includes(value));
});

