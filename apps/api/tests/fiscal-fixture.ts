import "reflect-metadata";
import { Module, type INestApplication, type ModuleMetadata } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { after } from "node:test";
import pg from "pg";
import { PRISMA_CLIENT } from "../src/shared/persistence/persistence.module.js";
import { parseFiscalTestDatabaseUrl } from "../src/testing/fiscal-test-database.js";
export { parseFiscalTestDatabaseUrl } from "../src/testing/fiscal-test-database.js";

const require = createRequire(import.meta.url);
const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
const fiscalMigrationPath = fileURLToPath(new URL("../prisma/deploy-migrations/20261114120000_fiscal_invoicing/migration.sql", import.meta.url));
const automaticCleanups = new Set<() => Promise<void>>();
const testRunner = ["child", "child-v8"].includes(process.env.NODE_TEST_CONTEXT ?? "");

// Register in the suite's import scope, never inside its before hook (which
// would close a successfully initialized shared fixture before tests run).
if (testRunner) after(async () => {
  const results = await Promise.allSettled([...automaticCleanups].map(cleanup => cleanup()));
  const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (failures.length) throw new AggregateError(failures, "fiscal_fixture_cleanup_failed");
});

/** Prisma db push omits partial indexes, CHECKs and triggers: reuse their production SQL. */
export function fiscalMigrationInvariants(): string {
  const source = readFileSync(fiscalMigrationPath, "utf8").replaceAll("\r\n", "\n");
  const marker = "-- Fiscal custom invariants\n";
  const offset = source.indexOf(marker);
  if (offset < 0 || source.indexOf(marker, offset + marker.length) >= 0) throw new Error("fiscal_fixture_invariant_source_invalid");
  const sql = source.slice(offset + marker.length);
  if (!sql.trim()) throw new Error("fiscal_fixture_invariant_source_empty");
  return sql;
}

/** Both Nest nodes use actual PostgreSQL. The fixture owns only its random schema. */
export async function createFiscalFixture(options: Pick<ModuleMetadata, "imports" | "controllers" | "providers"> & {
  initializeSchema?: boolean; rawBody?: boolean;
} = {}) {
  const target = parseFiscalTestDatabaseUrl(process.env.FISCAL_TEST_DATABASE_URL);
  const schema = "fiscal_test_" + randomUUID().replaceAll("-", "");
  const tag = schema;
  const database = new URL(target);
  database.searchParams.set("schema", schema);
  const admin = new pg.Pool({ connectionString: target.toString() });
  const sql = new pg.Pool({ connectionString: target.toString(), options: "-c search_path=" + schema });
  const prisma = new PrismaClient({ datasources: { db: { url: database.toString() } } });
  const apps: INestApplication[] = [];
  let schemaCreated = false;
  let closing: Promise<void> | undefined;
  let initializationFinished = false;
  let finishInitialization!: () => void;
  const initialized = new Promise<void>(resolve => { finishInitialization = resolve; });

  // A hook deadline can run the caller's after() before its fixture is assigned.
  // Only unfinished setup needs this safety net. Normal callers must retain their
  // explicit teardown order, including applications outside this fixture's list.
  if (testRunner) {
    automaticCleanups.add(async () => {
      if (initializationFinished) return;
      await initialized;
      await close();
    });
  }

  async function close() {
    closing ??= (async () => {
      const failures: unknown[] = [];
      async function attempt(action: () => Promise<unknown>) {
        try { await action(); } catch (error) { failures.push(error); }
      }
      await Promise.all(apps.map(async app => {
        await attempt(() => app.close());
        // A failing Nest destroy hook must not leave its HTTP listener behind.
        const server = app.getHttpServer();
        if (server?.listening) {
          server.closeAllConnections?.();
          await attempt(() => new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve())));
        }
      }));
      await attempt(() => prisma.$disconnect());
      await attempt(() => sql.end());
      if (schemaCreated) {
        await attempt(async () => {
          // The identifier is generated here; a caller cannot supply a teardown target.
          if (!/^fiscal_test_[a-f0-9]{32}$/.test(schema)) throw new Error("fiscal_fixture_invalid_owned_schema");
          await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        });
      }
      await attempt(() => admin.end());
      if (failures.length) throw new AggregateError(failures, "fiscal_fixture_cleanup_failed");
    })();
    return closing;
  }

  async function start() {
    class FiscalFixtureModule {}
    Module({ imports: options.imports ?? [], controllers: options.controllers ?? [], providers: [
      { provide: PRISMA_CLIENT, useValue: prisma }, ...(options.providers ?? []),
    ] })(FiscalFixtureModule);
    const app = await NestFactory.create(FiscalFixtureModule, { logger: false, abortOnError: false, rawBody: options.rawBody ?? false });
    apps.push(app);
    app.setGlobalPrefix("v1");
    await app.listen(0, "127.0.0.1");
    return { app, url: await app.getUrl() };
  }

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    if (options.initializeSchema !== false) {
      execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--schema", schemaPath, "--skip-generate"], {
        env: { ...process.env, DATABASE_URL: database.toString() }, encoding: "utf8", stdio: "pipe",
      });
      await sql.query(fiscalMigrationInvariants());
      const stages = readFileSync(fileURLToPath(new URL("../prisma/deploy-migrations/20261115170000_fiscal_durable_stages/migration.sql", import.meta.url)), "utf8");
      await sql.query(stages.slice(stages.indexOf("-- Fiscal durable-stage custom invariants")));
      await sql.query(readFileSync(fileURLToPath(new URL("../prisma/deploy-migrations/20261115190000_fiscal_artifact_immutability/migration.sql", import.meta.url)), "utf8"));
      const delivery = readFileSync(fileURLToPath(new URL("../prisma/deploy-migrations/20261115200000_fiscal_delivery_binding/migration.sql", import.meta.url)), "utf8");
      await sql.query(delivery.slice(delivery.indexOf("-- Fiscal delivery custom invariants")));
      const cancellation = readFileSync(fileURLToPath(new URL("../prisma/deploy-migrations/20261115210000_fiscal_cancellation_fence/migration.sql", import.meta.url)), "utf8");
      await sql.query(cancellation.slice(cancellation.indexOf("-- Fiscal cancellation custom invariants")));
      const receipt = readFileSync(fileURLToPath(new URL("../prisma/deploy-migrations/20261115230000_private_payment_receipt/migration.sql", import.meta.url)), "utf8");
      await sql.query(receipt.slice(receipt.indexOf("CREATE FUNCTION")));

    }
    await prisma.$connect();
    const first = await start();
    const second = await start();
    return { prisma, sql, schema, tag, databaseUrl: database.toString(), first, second, start, close };
  } catch (error) { await close(); throw error; }
  finally { initializationFinished = true; finishInitialization(); }
}
