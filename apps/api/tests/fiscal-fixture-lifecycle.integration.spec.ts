import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { parseFiscalTestDatabaseUrl } from "./fiscal-fixture.js";

type Event = { event: string; pid: number; schema?: string; url?: string; urls?: string[]; backend?: number; assigned?: boolean; testContext?: string | null };
async function childFixture(t: TestContext, mode: string) {
  const directory = mkdtempSync(join(tmpdir(), "fiscal-lifecycle-"));
  const journal = join(directory, "events.jsonl");
  const events = (): Event[] => existsSync(journal) ? readFileSync(journal, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const env = { ...process.env, FISCAL_LIFECYCLE_MODE: mode, FISCAL_LIFECYCLE_JOURNAL: journal };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ["--loader", "./apps/api/tests/platform-support-loader.mjs",
    ...(mode === "standalone" ? [] : ["--test", "--test-reporter=tap"]),
    "./apps/api/tests/fixtures/fiscal-fixture-lifecycle.fixture.ts"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const pool = new pg.Pool({ connectionString: parseFiscalTestDatabaseUrl(process.env.FISCAL_TEST_DATABASE_URL).toString() });
  t.after(async () => {
    // Failure/RED recovery touches only this child's evidenced PIDs and generated schema.
    if (child.exitCode === null && child.signalCode === null) {
      for (const pid of new Set(events().map(event => event.pid))) {
        if (pid !== process.pid) { try { process.kill(pid); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } }
      }
      child.kill();
      await exited;
    }
    try {
      for (const schema of new Set(events().filter(event => event.event === "schema").map(event => event.schema!))) {
        assert.match(schema, /^fiscal_test_[a-f0-9]{32}$/);
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      await pool.end();
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.ok(basename(directory).startsWith("fiscal-lifecycle-"));
      rmSync(directory, { recursive: true, force: true });
    }
  });
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 30_000;
    while (!predicate() && Date.now() < deadline) await delay(25);
    assert.ok(predicate(), "controlled child did not reach its expected stage: " + output);
  }
  async function naturalExit() {
    const deadline = delay(30_000, undefined, { ref: false });
    const result = await Promise.race([exited, deadline]);
    t.diagnostic(JSON.stringify({ mode, child: child.pid, naturalExit: Boolean(result), events: events(), output }));
    assert.ok(result, "controlled child remained alive after setup/cleanup");
    assert.equal(result.signal, null, "GREEN requires natural exit, without a signal");
    return result.code;
  }
  async function assertClean() {
    const owned = events().filter(event => event.event === "schema");
    assert.equal(owned.length, 1);
    const schema = owned[0]!.schema!;
    assert.deepEqual((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname=$1", [schema])).rows, []);
    const backends = [...new Set(events().flatMap(event => event.backend ? [event.backend] : []))];
    assert.ok(backends.length >= 2, "admin and Prisma PostgreSQL clients were exercised");
    assert.deepEqual((await pool.query("SELECT pid FROM pg_stat_activity WHERE pid = ANY($1::int[])", [backends])).rows, []);
    for (const event of events().filter(event => event.event === "listener")) {
      const target = new URL(event.url!);
      const listening = await new Promise<boolean>((resolve, reject) => {
        const socket = createConnection({ host: target.hostname, port: Number(target.port) });
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", error => { socket.destroy(); if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") resolve(false); else reject(error); });
      });
      assert.equal(listening, false, "owned Nest listener must close");
    }
  }
  return { child, events, until, naturalExit, assertClean, output: () => output };
}

test("fiscal fixture lifecycle cleans setup finishing after the before-hook deadline", { timeout: 60_000 }, async t => {
  const child = await childFixture(t, "late");
  assert.equal(await child.naturalExit(), 1, "expected hook failure remains visible");
  assert.match(child.output(), /failed running before hook/);
  assert.equal(child.events().find(event => event.event === "deadline")?.assigned, false);
  assert.equal(child.events().filter(event => event.event === "caller-after").length, 1);
  assert.ok(child.events().findIndex(event => event.event === "deadline") < child.events().findIndex(event => event.event === "ready"));
  assert.equal(child.events().filter(event => event.event === "listener").length, 2);
  assert.equal(child.events().filter(event => event.event === "ready").length, 1);
  await child.assertClean();
});

test("fiscal fixture lifecycle cleans a partial second-node initialization failure", { timeout: 60_000 }, async t => {
  const child = await childFixture(t, "partial");
  assert.equal(await child.naturalExit(), 0);
  assert.equal(child.events().filter(event => event.event === "listener").length, 1);
  assert.equal(child.events().filter(event => event.event === "partial-rejected").length, 1);
  await child.assertClean();
});

test("fiscal fixture lifecycle preserves normal shared-before caller teardown order", { timeout: 60_000 }, async t => {
  const child = await childFixture(t, "normal");
  assert.equal(await child.naturalExit(), 0);
  assert.equal(child.events().filter(event => event.event === "listener").length, 2);
  assert.equal(child.events().filter(event => event.event === "normal-caller-closed").length, 1);
  await child.assertClean();
});

test("fiscal fixture lifecycle cleans remaining resources even when an app close fails", { timeout: 60_000 }, async t => {
  const child = await childFixture(t, "close-error");
  assert.equal(await child.naturalExit(), 1, "automatic cleanup must report the real close failure");
  assert.match(child.output(), /fiscal_fixture_cleanup_failed/);
  assert.equal(child.events().filter(event => event.event === "listener").length, 2);
  assert.equal(child.events().filter(event => event.event === "close-rejected").length, 1);
  await child.assertClean();
});

test("fiscal fixture lifecycle preserves explicit standalone browser and manual ownership", { timeout: 60_000 }, async t => {
  const child = await childFixture(t, "standalone");
  await child.until(() => child.events().some(event => event.event === "ready"));
  await delay(300);
  assert.equal(child.child.exitCode, null);
  assert.equal(child.events()[0]!.testContext, null);
  const ready = child.events().find(event => event.event === "ready")!;
  assert.equal(ready.urls!.length, 2);
  for (const url of ready.urls!) {
    const response = await fetch(url + "/v1/probe", { headers: { Connection: "close" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { schema: ready.schema });
  }
  child.child.stdin.end("close\n");
  assert.equal(await child.naturalExit(), 0);
  assert.equal(child.events().filter(event => event.event === "explicitly-closed").length, 1);
  await child.assertClean();
});
