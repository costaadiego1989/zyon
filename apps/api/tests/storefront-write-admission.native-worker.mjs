import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";

assert.equal(process.argv.length, 4, "native_worker_requires_parent_generated_url_and_run");
const [url, runId] = process.argv.slice(2);
const parsedUrl = assertNativePrismaUrl(url);
assert.equal(parsedUrl.searchParams.get("application_name"), `aacp_write_native_${runId}`);
assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"]) assert.equal(process.env[key], undefined, "native_worker_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
// Only after generated env metadata/file-presence and binary guards pass.
const { PrismaClient } = await import("@prisma/client");
const { PrismaStorefrontWriteAdmissionRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-write-admission.repository.ts");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
const repository = new PrismaStorefrontWriteAdmissionRepository(prisma);
let passed = 0, active = "fixture identity", maxConcurrentWaitingTransactions = 0;
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
const scope = (conversationId, merchantId = "synthetic-merchant", cartId = conversationId, principalId = "synthetic-principal") => ({ merchantId, conversationId, cartId, principalId });
const request = (bound, message = "synthetic-message") => ({ scope: bound, intent: { version: 1, message_id: message, expected_revision: 0,
  command: { tool: "add_item_to_cart", args: { variantId: "synthetic-variant", quantity: 1 } } }, fingerprint: { version: 1, bytes: Uint8Array.from({ length: 32 }, () => 17) } });
const provision = async bound => {
  await prisma.$executeRaw`INSERT INTO merchants (id) VALUES (${bound.merchantId}) ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO storefront_execution_scopes (merchant_id,conversation_id,cart_id,principal_id)
    VALUES (${bound.merchantId},${bound.conversationId},${bound.cartId},${bound.principalId})`;
};
const rows = bound => prisma.$queryRaw`SELECT id, status, message_id AS message, encode(request_fingerprint,'hex') AS fingerprint,
  cart_id AS cart, finished_at >= started_at AS finished FROM storefront_write_requests WHERE merchant_id=${bound.merchantId} AND conversation_id=${bound.conversationId}`;
const synchronized = async (bound, inputs, whileBlocked) => {
  let held, release;
  const acquired = new Promise(resolve => { held = resolve; });
  const unlock = new Promise(resolve => { release = resolve; });
  const key = JSON.stringify(["storefront-cart", bound.merchantId, bound.cartId]);
  const holder = prisma.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; held(); await unlock; }, { maxWait: 10_000, timeout: 15_000 });
  holder.catch(() => held());
  let pending;
  try {
    await acquired;
    pending = Promise.all(inputs.map(input => repository.admit(input))).then(results => ({ results }), error => ({ error }));
    let waiting = 0;
    for (let attempt = 0; attempt < 60; attempt++) {
      const [{ count }] = await prisma.$queryRaw`SELECT count(DISTINCT a.pid)::int AS count FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
        WHERE a.application_name=${`aacp_write_native_${runId}`} AND l.locktype='advisory' AND NOT l.granted`;
      waiting = count; if (waiting === inputs.length) break;
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    assert.equal(waiting, inputs.length, "all_native_transactions_must_overlap_at_cart_lock");
    maxConcurrentWaitingTransactions = Math.max(maxConcurrentWaitingTransactions, waiting);
    whileBlocked?.(); release(); await holder;
    const outcome = await pending; if (outcome.error) throw outcome.error; return outcome.results;
  } finally { release(); await holder; if (pending) await pending; }
};

try {
  await prisma.$connect();
  const [marker] = await prisma.$queryRaw`SELECT current_database() AS database, run_id FROM synthetic_native_marker`;
  assert.deepEqual(marker, { database: "storefront_synthetic", run_id: runId });
  await check("actual Prisma engine connects only to owned synthetic marker and PostgreSQL16", async () => {
    const [{ version }] = await prisma.$queryRaw`SELECT current_setting('server_version') AS version`;
    assert.ok(version.startsWith("16."));
  });
  await check("real adapter admits once and returns a token-free duplicate receipt", async () => {
    const bound = scope("duplicate"); await provision(bound); const input = request(bound);
    const first = await repository.admit(input); assert.equal(first.kind, "claimed");
    const duplicate = await repository.admit(input);
    assert.deepEqual(duplicate, { kind: "receipt_required", requestId: first.claim.requestId, state: "processing" });
    assert.equal((await rows(bound)).length, 1);
  });
  await check("real adapter compares exact fingerprint bytes/version/revision and preserves original lane", async () => {
    const bound = scope("conflicts"); await provision(bound); const input = request(bound); await repository.admit(input);
    for (const changed of [{ ...input, fingerprint: { ...input.fingerprint, bytes: Uint8Array.from({ length: 32 }, () => 34) } },
      { ...input, fingerprint: { ...input.fingerprint, version: 2 } }, { ...input, intent: { ...input.intent, expected_revision: 1 } }])
      assert.deepEqual(await repository.admit(changed), { kind: "identity_conflict" });
    assert.deepEqual(await repository.admit(request(bound, "fresh-key")), { kind: "lane_blocked" });
    assert.equal((await rows(bound)).length, 1);
  });
  await check("missing or mismatched merchant/cart/principal scope is unavailable without creation", async () => {
    const bound = scope("scope-check"); await provision(bound);
    for (const changed of [{ ...bound, merchantId: "foreign" }, { ...bound, cartId: "foreign" }, { ...bound, principalId: "foreign" }, scope("missing")])
      assert.deepEqual(await repository.admit(request(changed)), { kind: "scope_unavailable" });
    assert.equal((await rows(bound)).length, 0);
  });
  await check("stale revision is refused before any request is persisted", async () => {
    const bound = scope("revision-check"); await provision(bound); const input = request(bound); input.intent.expected_revision = 1;
    assert.deepEqual(await repository.admit(input), { kind: "revision_conflict" }); assert.equal((await rows(bound)).length, 0);
  });
  await check("twenty actual adapter transactions overlap and claim one identical request", async () => {
    const bound = scope("same-key-race"); await provision(bound);
    const results = await synchronized(bound, Array.from({ length: 20 }, () => request(bound)));
    assert.equal(results.filter(value => value.kind === "claimed").length, 1);
    assert.equal(results.filter(value => value.kind === "receipt_required").length, 19);
    assert.equal((await rows(bound)).length, 1);
  });
  await check("twenty actual distinct message IDs cannot bypass the unresolved lane", async () => {
    const bound = scope("distinct-key-race"); await provision(bound);
    const results = await synchronized(bound, Array.from({ length: 20 }, (_, i) => request(bound, `message-${i}`)));
    assert.equal(results.filter(value => value.kind === "claimed").length, 1);
    assert.equal(results.filter(value => value.kind === "lane_blocked").length, 19);
    assert.equal((await rows(bound)).length, 1);
  });
  await check("native pending request snapshots bytes and primitives before awaiting the cart lock", async () => {
    const bound = scope("snapshot"), input = request(bound); await provision(bound);
    const [result] = await synchronized(bound, [input], () => { input.scope.cartId = "changed"; input.intent.message_id = "changed"; input.fingerprint.bytes.fill(34); });
    assert.equal(result.kind, "claimed"); const [row] = await rows(bound);
    assert.equal(row.cart, "snapshot"); assert.equal(row.message, "synthetic-message"); assert.equal(row.fingerprint, "11".repeat(32));
  });
  await check("parameterized Unicode/quoted cart scope uses exact shared advisory namespace", async () => {
    const bound = scope("quoted-cart", "synthetic-merchant", 'cart"\\ç😀'); await provision(bound);
    assert.equal((await synchronized(bound, [request(bound)]))[0].kind, "claimed");
  });
  await check("markUnknown requires scoped original claim token and never releases lane", async () => {
    const bound = scope("unknown"); await provision(bound); const input = request(bound); const result = await repository.admit(input);
    const stale = { ...result.claim, claimToken: randomUUID() };
    assert.deepEqual(await repository.markUnknown({ scope: bound, claim: stale }), { kind: "not_current" });
    assert.deepEqual(await repository.markUnknown({ scope: { ...bound, principalId: "foreign" }, claim: result.claim }), { kind: "not_current" });
    assert.deepEqual(await repository.markUnknown({ scope: bound, claim: result.claim }), { kind: "marked_unknown" });
    assert.deepEqual(await repository.markUnknown({ scope: bound, claim: result.claim }), { kind: "not_current" });
    assert.deepEqual(await repository.admit(input), { kind: "receipt_required", requestId: result.claim.requestId, state: "unknown" });
    assert.deepEqual(await repository.admit(request(bound, "new-message")), { kind: "lane_blocked" });
    assert.equal((await rows(bound))[0].finished, true);
  });
  await check("unrelated merchants/conversations admit independently", async () => {
    const bounds = [scope("independent-a"), scope("independent-a", "other-merchant")];
    for (const bound of bounds) await provision(bound);
    const results = await Promise.all(bounds.map(bound => repository.admit(request(bound))));
    assert.ok(results.every(result => result.kind === "claimed"));
  });
  await check("database insert rejection propagates once and never yields a claimed result", async () => {
    await prisma.$executeRaw`CREATE SEQUENCE synthetic_native_attempts`;
    await prisma.$executeRaw`CREATE FUNCTION synthetic_native_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.conversation_id='fail-insert' THEN PERFORM nextval('synthetic_native_attempts'); RAISE EXCEPTION 'synthetic_insert_rejection'; END IF; RETURN NEW; END $$`;
    await prisma.$executeRaw`CREATE TRIGGER synthetic_native_insert_rejection AFTER INSERT ON storefront_write_requests FOR EACH ROW EXECUTE FUNCTION synthetic_native_fail_insert()`;
    const bound = scope("fail-insert"); await provision(bound);
    await assert.rejects(repository.admit(request(bound)));
    assert.equal((await rows(bound)).length, 0);
    const [{ value }] = await prisma.$queryRaw`SELECT last_value::int AS value FROM synthetic_native_attempts`; assert.equal(value, 1);
  });
  await check("deferred PostgreSQL COMMIT rejection propagates with no claimed result or automatic retry", async () => {
    await prisma.$executeRaw`CREATE FUNCTION synthetic_native_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.conversation_id='fail-commit' THEN PERFORM nextval('synthetic_native_attempts'); RAISE EXCEPTION 'synthetic_commit_rejection'; END IF; RETURN NEW; END $$`;
    await prisma.$executeRaw`CREATE CONSTRAINT TRIGGER synthetic_native_commit_rejection AFTER INSERT ON storefront_write_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_native_fail_commit()`;
    const bound = scope("fail-commit"); await provision(bound);
    await assert.rejects(repository.admit(request(bound))); assert.equal((await rows(bound)).length, 0);
    const [{ value }] = await prisma.$queryRaw`SELECT last_value::int AS value FROM synthetic_native_attempts`; assert.equal(value, 2);
  });
  console.log(JSON.stringify({ status: "passed", tests: passed, actualPrismaAdapter: true, maxConcurrentWaitingTransactions,
    prismaClients: 1, databaseNetwork: "none", transport: "127.0.0.1-ephemeral-to-owned-docker-exec-nc", businessExactlyOnceProven: false, productionAccess: false }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", test: active, errorType: error?.name ?? "Error", code: typeof error?.code === "string" ? error.code : undefined }));
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
