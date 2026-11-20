import "reflect-metadata";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { Controller, Get, Inject } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PRISMA_CLIENT } from "../../src/shared/persistence/persistence.module.js";
import { createFiscalFixture } from "../fiscal-fixture.js";

const mode = process.env.FISCAL_LIFECYCLE_MODE;
function record(event: Record<string, unknown>) {
  appendFileSync(process.env.FISCAL_LIFECYCLE_JOURNAL!, JSON.stringify({ pid: process.pid, ...event }) + "\n");
}
record({ event: "started", testContext: process.env.NODE_TEST_CONTEXT ?? null });

// Observe only resources created by this controlled child. No fixture injection API.
const query = pg.Pool.prototype.query;
pg.Pool.prototype.query = async function (...args: any[]) {
  const result = await (query as any).apply(this, args);
  const schema = typeof args[0] === "string" && /^CREATE SCHEMA "(fiscal_test_[a-f0-9]{32})"$/.exec(args[0]);
  if (schema) {
    const backend = await (query as any).call(this, "SELECT pg_backend_pid() AS pid");
    record({ event: "schema", schema: schema[1], backend: backend.rows[0].pid });
  }
  return result;
} as any;
const connect = PrismaClient.prototype.$connect;
PrismaClient.prototype.$connect = async function () {
  await connect.call(this);
  const rows = await this.$queryRawUnsafe<{ pid: number }[]>("SELECT pg_backend_pid() AS pid");
  record({ event: "client", backend: rows[0]!.pid });
};
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args: any[]) {
  this.once("listening", () => {
    const address = this.address();
    if (address && typeof address !== "string") record({ event: "listener", url: "http://127.0.0.1:" + address.port });
  });
  return (listen as any).apply(this, args);
} as any;

@Controller("probe")
class ProbeController {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  @Get() async read() {
    const rows = await this.prisma.$queryRawUnsafe<{ schema: string }[]>("SELECT current_schema() AS schema");
    return rows[0];
  }
}
let fixture: Awaited<ReturnType<typeof createFiscalFixture>> | undefined;
async function ready() {
  const rows = await fixture!.sql.query("SELECT pg_backend_pid() AS pid");
  record({ event: "ready", schema: fixture!.schema, urls: [fixture!.first.url, fixture!.second.url], backend: rows.rows[0].pid });
}

if (mode === "standalone") {
  fixture = await createFiscalFixture({ initializeSchema: false, controllers: [ProbeController] });
  await ready();
  // Browser/manual helpers keep explicit ownership until their caller requests close.
  process.stdin.once("data", async () => {
    await fixture!.close();
    await fixture!.close();
    record({ event: "explicitly-closed" });
    process.stdin.pause();
  });
  process.stdin.resume();
} else {
  const { test, before, after } = await import("node:test");
  if (mode === "late") {
    before(async () => {
      const deadline = setTimeout(() => record({ event: "deadline", assigned: Boolean(fixture) }), 100);
      try {
        fixture = await createFiscalFixture({ initializeSchema: false, providers: [{
          provide: "late-provider", useFactory: async () => { await delay(500); return {}; },
        }] });
        await ready();
      } finally { clearTimeout(deadline); }
    }, { timeout: 100 });
    after(async () => {
      record({ event: "caller-after", assigned: Boolean(fixture) });
      await fixture?.close();
    });
    test("controlled late setup must fail its before hook", () => assert.fail("hook deadline must prevent this test body"));
  } else if (mode === "normal") {
    before(async () => {
      fixture = await createFiscalFixture({ initializeSchema: false, controllers: [ProbeController] });
      await ready();
    });
    after(async () => {
      // External AppModule callers destroy their application before f.close().
      // Their destroy hooks must still be able to use both database clients.
      const sql = await fixture!.sql.query("SELECT current_schema() AS schema");
      const prisma = await fixture!.prisma.$queryRawUnsafe<{ schema: string }[]>("SELECT current_schema() AS schema");
      assert.deepEqual(sql.rows, [{ schema: fixture!.schema }]);
      assert.deepEqual(prisma, [{ schema: fixture!.schema }]);
      await fixture!.close();
      record({ event: "normal-caller-closed" });
    });
    test("controlled shared-before fixture stays available through caller teardown", async () => {
      for (const url of [fixture!.first.url, fixture!.second.url]) {
        const response = await fetch(url + "/v1/probe", { headers: { Connection: "close" } });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { schema: fixture!.schema });
      }
    });
  } else if (mode === "partial") {
    let nodes = 0;
    test("controlled second-node initialization failure closes partial fixture", async () => {
      await assert.rejects(createFiscalFixture({ initializeSchema: false, providers: [{
        provide: "partial-provider", useFactory: () => ({
          onModuleInit() { if (++nodes === 2) throw new Error("controlled_partial_initialization"); },
        }),
      }] }), /controlled_partial_initialization/);
      record({ event: "partial-rejected" });
    });
  } else if (mode === "close-error") {
    after(async () => { await fixture?.close(); });
    test("controlled app close failure still closes clients and drops schema", async () => {
      fixture = await createFiscalFixture({ initializeSchema: false, providers: [{
        provide: "close-provider", useFactory: () => ({
          onModuleDestroy() { throw new Error("controlled_app_close_failure"); },
        }),
      }] });
      await ready();
      await assert.rejects(fixture.close(), (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.message, "fiscal_fixture_cleanup_failed");
        assert.deepEqual(error.errors.map(failure => failure.message), ["controlled_app_close_failure", "controlled_app_close_failure"]);
        return true;
      });
      record({ event: "close-rejected" });
    });
  } else {
    throw new Error("unknown_controlled_lifecycle_mode");
  }
}
