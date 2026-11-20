import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { PRISMA_CLIENT } from "../src/shared/persistence/persistence.module.js";
import { createFiscalFixture, parseFiscalTestDatabaseUrl } from "./fiscal-fixture.js";

@Controller("fixture")
class FiscalProbeController {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  @Post("merchants") create(@Body() input: { id: string; name: string }) {
    return this.prisma.merchant.create({ data: { id: input.id, name: input.name }, select: { id: true, name: true } });
  }
  @Get("merchants/:id") read(@Param("id") id: string) {
    return this.prisma.merchant.findUnique({ where: { id }, select: { id: true, name: true } });
  }
}

test("fiscal fixture rejects missing, remote and ambiguous database targets before connecting", () => {
  for (const url of [
    undefined, "", "https://localhost/zyon_fiscal", "postgresql://remote.example/zyon_fiscal",
    "postgresql://localhost/production", "postgresql://localhost/zyon_fiscal?host=remote.example",
    "postgresql://localhost/zyon_fiscal?options=-csearch_path=public", "postgresql://localhost/zyon_fiscal#other",
    "postgresql://localhost.evil.example/zyon_fiscal", "postgresql://localhost/zyon_fiscal/other",
  ]) assert.throws(() => parseFiscalTestDatabaseUrl(url), /fiscal_fixture_requires_isolated_local_database/);
  assert.equal(parseFiscalTestDatabaseUrl("postgresql://fiscal:local@127.0.0.1:25432/zyon_fiscal").port, "25432");
});

test("fiscal fixture starts two HTTP nodes sharing actual PostgreSQL persistence", { timeout: 120_000 }, async t => {
  const fixture = await createFiscalFixture({ controllers: [FiscalProbeController] });
  t.after(() => fixture.close());
  assert.notEqual(fixture.first.url, fixture.second.url);
  const data = { id: fixture.tag + "_seller", name: "Loja fiscal sintética" };
  const created = await fetch(fixture.first.url + "/v1/fixture/merchants", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), data);
  const found = await fetch(fixture.second.url + "/v1/fixture/merchants/" + data.id);
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), data);
  assert.deepEqual(await fixture.prisma.merchant.findUnique({ where: { id: data.id }, select: { id: true, name: true } }), data);
  assert.equal(new URL(fixture.databaseUrl).searchParams.get("schema"), fixture.schema);
});

test("fiscal fixture cleanup removes only its owned synthetic schema", { timeout: 120_000 }, async t => {
  const control = "fiscal_control_" + randomUUID().replaceAll("-", "");
  const pool = new pg.Pool({ connectionString: parseFiscalTestDatabaseUrl(process.env.FISCAL_TEST_DATABASE_URL).toString() });
  t.after(async () => { await pool.query(`DROP SCHEMA IF EXISTS "${control}" CASCADE`); await pool.end(); });
  await pool.query(`CREATE SCHEMA "${control}"`);
  await pool.query(`CREATE TABLE "${control}".sentinel (id integer PRIMARY KEY)`);
  await pool.query(`INSERT INTO "${control}".sentinel VALUES (17)`);
  const fixture = await createFiscalFixture();
  await fixture.close();
  await fixture.close();
  assert.deepEqual((await pool.query(`SELECT id FROM "${control}".sentinel`)).rows, [{ id: 17 }]);
  assert.deepEqual((await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1", [fixture.schema])).rows, []);
});

test("separate fiscal fixtures cannot read or remove each other's tenant data", { timeout: 120_000 }, async t => {
  const first = await createFiscalFixture();
  t.after(() => first.close());
  const second = await createFiscalFixture();
  t.after(() => second.close());
  const id = first.tag + "_seller";
  await first.prisma.merchant.create({ data: { id, name: "Primeiro schema" } });
  assert.equal(await second.prisma.merchant.findUnique({ where: { id } }), null);
  await second.close();
  assert.equal((await first.prisma.merchant.findUniqueOrThrow({ where: { id } })).name, "Primeiro schema");
});
