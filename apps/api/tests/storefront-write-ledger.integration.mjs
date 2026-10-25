import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";

assert.ok(process.argv.includes("--local-disposable"), "explicit_local_disposable_flag_required");
const db = await createDisposablePostgres();
let passed = 0;
const check = async (name, work) => { await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
const literal = value => `'${value.replaceAll("'", "''")}'`;
const scope = async (merchant, conversation, cart = conversation, principal = "synthetic-principal") => {
  await db.sql(`INSERT INTO merchants VALUES (${literal(merchant)}) ON CONFLICT DO NOTHING;
    INSERT INTO storefront_execution_scopes (merchant_id, conversation_id, cart_id, principal_id)
    VALUES (${[merchant, conversation, cart, principal].map(literal).join(",")});`);
};
const insert = (conversation, message, { merchant = "synthetic-merchant", cart = conversation, principal = "synthetic-principal", version = 1,
  revision = 0, fingerprintVersion = 1, fingerprintBytes = 32, kind = "add_item_to_cart", status = "processing" } = {}) =>
  `INSERT INTO storefront_write_requests (merchant_id, conversation_id, cart_id, principal_id, message_id,
    protocol_version, fingerprint_version, request_fingerprint, command_kind, expected_revision, status)
    VALUES (${[merchant, conversation, cart, principal, message].map(literal).join(",")}, ${version}, ${fingerprintVersion},
    decode(repeat('11',${fingerprintBytes}),'hex'), ${literal(kind)}, ${revision}, ${literal(status)})`;
const expectSqlError = (query, state) => assert.rejects(db.sql(query), error => error.stderr?.includes(state));
const claims = async (conversation, messages, options, gate) => Promise.all(messages.map(message => db.sql(`
  ${gate ? `BEGIN; SET lock_timeout='10s'; SET statement_timeout='20s'; SET application_name=${literal(gate.clients)};
    SELECT pg_advisory_xact_lock_shared(hashtextextended(${literal(gate.key)},0));` : ""}
  WITH claimed AS (${insert(conversation, message, options)} ON CONFLICT DO NOTHING RETURNING id),
  work AS (INSERT INTO synthetic_work_invocations SELECT id FROM claimed RETURNING request_id)
  SELECT json_build_object('pid', pg_backend_pid(), 'work', (SELECT count(*) FROM work));
  ${gate ? "COMMIT;" : ""}`).then(JSON.parse)));
let gateOrdinal = 0;
const synchronizedClaims = async (conversation, messages) => {
  const ordinal = ++gateOrdinal;
  const gate = { key: `fixture_gate_${db.runId}_${ordinal}`, clients: `race_${db.runId}_${ordinal}` };
  const coordinator = `gate_${db.runId}_${ordinal}`;
  const holding = db.sql(`SET statement_timeout='25s'; SET application_name=${literal(coordinator)};
    BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${literal(gate.key)},0)); SELECT pg_sleep(20); COMMIT;`).then(() => {}, () => {});
  let pid, pending;
  try {
    for (let index = 0; index < 40; index++) {
      const value = await db.sql(`SELECT pid FROM pg_stat_activity WHERE application_name=${literal(coordinator)} AND wait_event='PgSleep'`);
      if (value) { pid = Number(value); break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    pending = claims(conversation, messages, undefined, gate).then(results => ({ results }), error => ({ error }));
    let waiting = 0;
    for (let index = 0; index < 50; index++) {
      waiting = Number(await db.sql(`SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
        WHERE a.application_name=${literal(gate.clients)} AND l.locktype='advisory' AND NOT l.granted`));
      if (waiting === messages.length) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(waiting, 20, "all_twenty_connections_must_overlap_at_db_gate");
    await db.sql(`SELECT pg_terminate_backend(${pid})`); pid = undefined;
    await holding;
    const result = await pending;
    if (result.error) throw result.error;
    return result.results;
  } finally {
    if (pid) await db.sql(`SELECT pg_terminate_backend(${pid})`);
    await holding;
    if (pending) await pending;
  }
};
try {
  await db.sql('CREATE TABLE merchants (id TEXT PRIMARY KEY); INSERT INTO merchants VALUES (\'synthetic-merchant\');');
  await db.sql(await readFile(new URL("./fixtures/storefront-write-ledger/candidate.sql", import.meta.url), "utf8"));
  assert.equal(await db.sql("SELECT to_regclass('storefront_execution_scopes') IS NOT NULL"), "t", "candidate_scope_table_required");
  await db.sql("CREATE TABLE synthetic_work_invocations (request_id UUID PRIMARY KEY REFERENCES storefront_write_requests(id));");

  await check("20 identical deliveries use 20 DB connections and produce exactly one synthetic work invocation", async () => {
    await scope("synthetic-merchant", "same-key");
    const results = await synchronizedClaims("same-key", Array(20).fill("message"));
    assert.equal(new Set(results.map(row => row.pid)).size, 20);
    assert.equal(results.reduce((sum, row) => sum + row.work, 0), 1);
    assert.equal(await db.sql("SELECT count(*) FROM storefront_write_requests WHERE conversation_id='same-key'"), "1");
  });
  await check("20 different keys cannot evade the single unresolved lane", async () => {
    await scope("synthetic-merchant", "distinct-keys");
    const results = await synchronizedClaims("distinct-keys", Array.from({ length: 20 }, (_, index) => `message-${index}`));
    assert.equal(results.reduce((sum, row) => sum + row.work, 0), 1);
  });
  await check("unrelated merchants and conversations admit independently", async () => {
    await scope("other-merchant", "same-key");
    await scope("synthetic-merchant", "other-conversation");
    const [a, b] = await Promise.all([claims("same-key", ["message"], { merchant: "other-merchant" }), claims("other-conversation", ["message"])]);
    assert.equal(a[0].work + b[0].work, 2);
  });
  await check("protocol version is not another key namespace", async () => {
    await expectSqlError(insert("same-key", "message", { version: 2 }), "23505");
  });
  await check("unknown holds the lane and cannot become processing again", async () => {
    await db.sql("UPDATE storefront_write_requests SET status='unknown' WHERE conversation_id='same-key' AND merchant_id='synthetic-merchant'");
    await expectSqlError(insert("same-key", "fresh-message"), "23505");
    await expectSqlError("UPDATE storefront_write_requests SET status='processing', finished_at=NULL WHERE conversation_id='same-key'", "P0001");
  });
  await check("scope identity and ownership cannot change or be deleted", async () => {
    for (const update of ["principal_id='other'", "cart_id='other'", "scope_revision=1", "protocol_owned=false"])
      await expectSqlError(`UPDATE storefront_execution_scopes SET ${update} WHERE conversation_id='distinct-keys'`, "P0001");
    await expectSqlError("DELETE FROM storefront_execution_scopes WHERE conversation_id='distinct-keys'", "P0001");
  });
  await check("one cart cannot gain a second conversation scope", async () => {
    await expectSqlError("INSERT INTO storefront_execution_scopes(merchant_id,conversation_id,cart_id,principal_id) VALUES ('synthetic-merchant','second-scope','distinct-keys','synthetic-principal')", "23505");
  });
  await check("merchant deletion is restricted, not a cascade that reopens requests", async () => {
    await expectSqlError("DELETE FROM merchants WHERE id='synthetic-merchant'", "23503");
  });
  await check("request binding rejects foreign tenant, cart and principal", async () => {
    for (const options of [{ merchant: "foreign" }, { cart: "foreign" }, { principal: "foreign" }])
      await expectSqlError(insert("distinct-keys", "foreign-message", options), "23503");
  });
  await check("composite scope FK rejects mismatch independently of the application guard", async () => {
    await scope("synthetic-merchant", "fk-isolation");
    // Transactional DDL rolls back on either success or error; FK triggers stay enabled.
    await expectSqlError(`BEGIN; ALTER TABLE storefront_write_requests DISABLE TRIGGER storefront_request_guard;
      ${insert("fk-isolation", "foreign-key-check", { principal: "foreign" })}; ROLLBACK;`, "23503");
    assert.equal(await db.sql("SELECT tgenabled FROM pg_trigger WHERE tgname='storefront_request_guard'"), "O");
  });
  await check("stale revision is rejected before claim commit", async () => {
    await scope("synthetic-merchant", "revision-check");
    await expectSqlError(insert("revision-check", "message", { revision: 1 }), "P0001");
    assert.equal(await db.sql("SELECT count(*) FROM storefront_write_requests WHERE conversation_id='revision-check'"), "0");
  });
  await check("fingerprint, scope, command, generation and claim token are immutable", async () => {
    for (const update of ["request_fingerprint=decode(repeat('22',32),'hex')", "fingerprint_version=2", "protocol_version=2",
      "message_id='other'", "expected_revision=1", "principal_id='other'", "command_kind='apply_coupon'", "claim_generation=2", "claim_token=gen_random_uuid()"])
      await expectSqlError(`UPDATE storefront_write_requests SET ${update}, status='unknown' WHERE conversation_id='distinct-keys'`, "P0001");
    await expectSqlError("DELETE FROM storefront_write_requests WHERE conversation_id='distinct-keys'", "P0001");
  });
  await check("effect completion, rejection and reconciliation are unsupported without proof", async () => {
    for (const status of ["completed", "rejected", "reconciled", "arbitrary"])
      await expectSqlError(`UPDATE storefront_write_requests SET status=${literal(status)} WHERE conversation_id='distinct-keys'`, "P0001");
    await expectSqlError(insert("revision-check", "initial-unknown", { status: "unknown" }), "P0001");
  });
  for (const message of ["", " \t\n", "\u00a0\ufeff", "x".repeat(192), "😀".repeat(96)]) {
    await check(`bounded UTF-16/nonblank request ID rejects ${JSON.stringify(message).slice(0, 24)}`, async () => {
      await expectSqlError(insert("revision-check", message), "23514");
    });
  }
  await check("maximum-length Unicode ID is accepted without trimming", async () => {
    const message = "😀".repeat(95) + "x";
    await db.sql(`${insert("revision-check", message)};`);
    assert.equal(await db.sql("SELECT message_id FROM storefront_write_requests WHERE conversation_id='revision-check'"), message);
  });
  await check("malformed fingerprint and protocol are rejected by constraints", async () => {
    await scope("synthetic-merchant", "bounds-check");
    await expectSqlError(insert("bounds-check", "message", { version: 0 }), "23514");
    await expectSqlError(insert("bounds-check", "message", { fingerprintVersion: 0 }), "23514");
    await expectSqlError(insert("bounds-check", "message", { fingerprintBytes: 1 }), "23514");
    await expectSqlError(insert("bounds-check", "message", { fingerprintBytes: 129 }), "23514");
    await expectSqlError(insert("bounds-check", "message", { kind: "apply_coupon" }), "23514");
  });
  await check("rollback before claim commit leaves no durable request or work", async () => {
    await scope("synthetic-merchant", "rollback-check");
    await db.sql(`BEGIN; ${insert("rollback-check", "message")}; ROLLBACK;`);
    assert.equal(await db.sql("SELECT count(*) FROM storefront_write_requests WHERE conversation_id='rollback-check'"), "0");
    assert.equal((await claims("rollback-check", ["message"]))[0].work, 1);
  });
  await check("connection termination after COMMIT before composite operation resolves leaves processing durable", async () => {
    await scope("synthetic-merchant", "lost-ack");
    const clientName = `lost_ack_${db.runId}`;
    const disconnected = db.sql(`SET application_name=${literal(clientName)}; BEGIN; ${insert("lost-ack", "message")}; COMMIT; SELECT pg_sleep(10);`).then(() => ({ rejected: false }), () => ({ rejected: true }));
    let pid;
    for (let index = 0; index < 30; index++) {
      const result = await db.sql(`SELECT pid FROM pg_stat_activity WHERE application_name=${literal(clientName)} AND wait_event='PgSleep'`);
      if (result) { pid = Number(result); break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    assert.equal(await db.sql("SELECT status FROM storefront_write_requests WHERE conversation_id='lost-ack'"), "processing");
    assert.equal(await db.sql(`SELECT pg_terminate_backend(${pid})`), "t");
    assert.equal((await disconnected).rejected, true);
    assert.equal((await claims("lost-ack", ["message"]))[0].work, 0);
    assert.equal((await claims("lost-ack", ["another-id"]))[0].work, 0);
    assert.equal(await db.sql("SELECT count(*) FROM synthetic_work_invocations w JOIN storefront_write_requests r ON r.id=w.request_id WHERE r.conversation_id='lost-ack'"), "0");
  });
  await check("cart advisory lock uses exact existing compact JSON key, including escaping/Unicode", async () => {
    const cart = 'cart"\\ç';
    await scope("synthetic-merchant", "lock-check", cart);
    const key = JSON.stringify(["storefront-cart", "synthetic-merchant", cart]);
    const name = `lock_${db.runId}`;
    const holding = db.sql(`SET application_name=${literal(name)}; BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${literal(key)},0)); SELECT pg_sleep(10); COMMIT;`).then(() => {}, () => {});
    let pid;
    for (let index = 0; index < 30; index++) {
      const value = await db.sql(`SELECT pid FROM pg_stat_activity WHERE application_name=${literal(name)} AND wait_event='PgSleep'`);
      if (value) { pid = Number(value); break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    try {
      await expectSqlError(`SET lock_timeout='250ms'; ${insert("lock-check", "message", { cart })}`, "55P03");
      assert.equal(await db.sql("SELECT count(*) FROM storefront_write_requests WHERE conversation_id='lock-check'"), "0");
    } finally {
      await db.sql(`SELECT pg_terminate_backend(${pid})`); await holding;
    }
    assert.equal((await claims("lock-check", ["message"], { cart }))[0].work, 1);
  });
  await check("tables contain no raw args/text/token/response cache and do not depend on expirable carts", async () => {
    const columns = (await db.sql("SELECT column_name FROM information_schema.columns WHERE table_name IN ('storefront_write_requests','storefront_execution_scopes')")).split("\n");
    for (const field of ["args", "text", "prompt", "response", "bearer", "conversation_token"]) assert.ok(!columns.includes(field));
    assert.equal(await db.sql("SELECT count(*) FROM pg_constraint WHERE conrelid='storefront_execution_scopes'::regclass AND confrelid=to_regclass('storefront_carts')"), "0");
  });
  await check("TRUNCATE cannot erase a scope or request to reopen its lane", async () => {
    await expectSqlError("TRUNCATE storefront_write_requests CASCADE", "P0001");
    await expectSqlError("TRUNCATE storefront_execution_scopes CASCADE", "P0001");
    assert.equal(await db.sql("SELECT count(*) FROM storefront_write_requests WHERE conversation_id='lost-ack'"), "1");
  });
  await check("timestamps come from PostgreSQL and unknown transitions cannot be rewritten", async () => {
    await scope("synthetic-merchant", "timestamp-check");
    await db.sql(`${insert("timestamp-check", "message")}; UPDATE storefront_write_requests
      SET status='unknown', finished_at='1900-01-01' WHERE conversation_id='timestamp-check';`);
    assert.equal(await db.sql("SELECT finished_at >= started_at AND finished_at > '2000-01-01' FROM storefront_write_requests WHERE conversation_id='timestamp-check'"), "t");
    await expectSqlError("UPDATE storefront_write_requests SET status='unknown', finished_at=clock_timestamp() WHERE conversation_id='timestamp-check'", "P0001");
  });
  const serverVersion = await db.sql("SHOW server_version");
  assert.ok(serverVersion.startsWith("16."));
  console.log(JSON.stringify({ status: "passed", tests: passed, imageId: db.imageId, serverVersion, independentConnectionsPerRace: 20, network: db.network, businessExactlyOnceProven: false }));
} finally {
  await db.dispose();
  console.log(JSON.stringify({ disposableDatabaseRemoved: true, network: "none", productionAccess: false }));
}
