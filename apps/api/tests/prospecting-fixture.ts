import "./test-network-guard.mjs";
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Controller, Get, Inject, Module, Req, UseGuards, type Provider, type Type } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import pg from "pg";
import neo4j from "neo4j-driver";
import { Redis } from "ioredis";
import type { PlatformOperatorRepository, PlatformSessionRecord } from "../src/modules/platform-control/domain/ports/platform-operator-repository.port.js";
import type { PlatformOperator } from "../src/modules/platform-control/domain/platform-operator.js";
import { PlatformJwtService } from "../src/modules/platform-control/domain/services/platform-jwt.service.js";
import { PlatformAccessGuard } from "../src/modules/platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../src/modules/platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../src/modules/platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../src/modules/platform-control/presentation/platform-principal.js";

export interface ProspectingTestConfig { databaseUrl: string; neo4jUri: string; neo4jUser: string; neo4jPassword: string; redisUrl: string }
export function readProspectingTestConfig(): ProspectingTestConfig {
  // This receipt is created for the dedicated fixture environment. Never load .env.
  let receipt: Partial<ProspectingTestConfig> = {};
  try { receipt = JSON.parse(readFileSync(new URL("../../../.specs/features/admin-company-prospecting/environment.local.json", import.meta.url), "utf8")); } catch { /* Explicit test env remains supported. */ }
  const config = {
    databaseUrl: process.env.PROSPECTING_TEST_DATABASE_URL ?? receipt.databaseUrl,
    neo4jUri: process.env.PROSPECTING_TEST_NEO4J_URI ?? receipt.neo4jUri,
    neo4jUser: process.env.PROSPECTING_TEST_NEO4J_USER ?? receipt.neo4jUser,
    neo4jPassword: process.env.PROSPECTING_TEST_NEO4J_PASSWORD ?? receipt.neo4jPassword,
    redisUrl: process.env.PROSPECTING_TEST_REDIS_URL ?? receipt.redisUrl,
  };
  if (Object.values(config).some(value => !value)) throw new Error("prospecting_fixture_config_required");
  return config as ProspectingTestConfig;
}
function localUrl(value: string, name: string, protocols: string[]) {
  try {
    const url = new URL(value);
    if (!["127.0.0.1", "[::1]"].includes(url.hostname) || !protocols.includes(url.protocol) || url.hash) throw new Error();
    return url;
  } catch { throw new Error(`prospecting_fixture_requires_isolated_loopback:${name}`); }
}
export function validateProspectingTestConfig(config: ProspectingTestConfig): void {
  const database = localUrl(config.databaseUrl, "database", ["postgresql:", "postgres:"]);
  if (!/^\/(zyon_prospecting|prospecting_test(?:_[a-z0-9_]+)?)$/.test(database.pathname)) throw new Error("prospecting_fixture_requires_isolated_loopback:database_name");
  localUrl(config.neo4jUri, "neo4j", ["bolt:"]); localUrl(config.redisUrl, "redis", ["redis:"]);
  if (!config.neo4jUser || !config.neo4jPassword) throw new Error("prospecting_fixture_config_required");
}

/** Real disposable PostgreSQL schema. Its pool never searches merchant/public tables. */
export async function createProspectingDatabase(config = readProspectingTestConfig()) {
  validateProspectingTestConfig(config);
  const schema = "prospecting_fixture_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 1_000, max: 2 });
  const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 1_000, max: 4, options: `-c search_path=${schema}` });
  try { await admin.query(`CREATE SCHEMA "${schema}"`); await pool.query("SELECT 1"); }
  catch (error) { await pool.end(); await admin.end(); throw new Error("prospecting_fixture_dependency_unavailable:postgresql", { cause: error }); }
  return { schema, pg: pool, databaseUrl: config.databaseUrl, async close() { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); } };
}

// Pre-migration identity fixture stores every session in PostgreSQL. Authentication,
// audience, revocation and authorization still run through the production services.
class FixtureOperatorRepository implements PlatformOperatorRepository {
  constructor(private readonly pool: pg.Pool) {}
  async findByEmail(email: string): Promise<PlatformOperator | undefined> { return (await this.pool.query("SELECT id,email,role,auth_version AS \"authVersion\" FROM platform_operators WHERE email=$1", [email])).rows[0]; }
  async createSession(input: PlatformSessionRecord) {
    const result = await this.pool.query("INSERT INTO platform_auth_sessions (id,family_id,operator_id,auth_version,refresh_expires_at) SELECT $1,$2,id,$4,$5 FROM platform_operators WHERE id=$3 AND email=$6 AND role=$7 AND auth_version=$4 AND disabled_at IS NULL RETURNING id", [input.id, input.familyId, input.operatorId, input.authVersion, input.refreshExpiresAt, input.email, input.role]);
    return result.rowCount === 1;
  }
  async findActiveSession(id: string, now: Date): Promise<PlatformSessionRecord | undefined> {
    return (await this.pool.query('SELECT s.id,s.family_id AS "familyId",s.operator_id AS "operatorId",s.auth_version AS "authVersion",s.refresh_expires_at AS "refreshExpiresAt",o.email,o.role FROM platform_auth_sessions s JOIN platform_operators o ON o.id=s.operator_id WHERE s.id=$1 AND s.consumed_at IS NULL AND s.revoked_at IS NULL AND s.refresh_expires_at>$2 AND o.disabled_at IS NULL AND o.auth_version=s.auth_version', [id, now])).rows[0];
  }
  async rotateSession(id: string, replacement: PlatformSessionRecord, now: Date) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query("UPDATE platform_auth_sessions s SET consumed_at=$2 FROM platform_operators o WHERE s.id=$1 AND o.id=s.operator_id AND o.id=$3 AND o.auth_version=$4 AND o.email=$5 AND o.role=$6 AND o.disabled_at IS NULL AND s.consumed_at IS NULL AND s.revoked_at IS NULL AND s.refresh_expires_at>$2 RETURNING s.id", [id, now, replacement.operatorId, replacement.authVersion, replacement.email, replacement.role]);
      if (!claimed.rowCount) { await client.query("ROLLBACK"); return false; }
      await client.query("INSERT INTO platform_auth_sessions (id,family_id,operator_id,auth_version,refresh_expires_at) VALUES ($1,$2,$3,$4,$5)", [replacement.id, replacement.familyId, replacement.operatorId, replacement.authVersion, replacement.refreshExpiresAt]);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async revokeSessionFamily(id: string, now: Date) { await this.pool.query("UPDATE platform_auth_sessions SET revoked_at=$2 WHERE family_id=(SELECT family_id FROM platform_auth_sessions WHERE id=$1)", [id, now]); }
}
export const PROSPECTING_FIXTURE_PG = Symbol("PROSPECTING_FIXTURE_PG");
@Controller("prospecting-fixture") @UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
class FixtureController {
  constructor(@Inject(PROSPECTING_FIXTURE_PG) private readonly pool: pg.Pool) {}
  @Get("state") async state(@Req() request: PlatformPrincipalRequest) {
    return { operatorId: currentPlatformPrincipal(request).operatorId, persisted: (await this.pool.query("SELECT value FROM fixture_business_state WHERE id='proof'")).rows[0].value };
  }
  @Get("admin") @RequirePlatformPermissions("platform:operators:read") admin() { return { allowed: true }; }
}
function capturedPort() {
  const calls: unknown[] = [];
  return { calls, async invoke(input: unknown) { calls.push(structuredClone(input)); return { mode: "controlled" as const }; } };
}
export async function createProspectingFixture(options: { config?: ProspectingTestConfig; controllers?: Type[]; providers?: Provider[]; port?: number } = {}) {
  const config = options.config ?? readProspectingTestConfig();
  // Validate ALL addresses before constructing any client or connecting.
  validateProspectingTestConfig(config);
  const database = await createProspectingDatabase(config);
  const tag = database.schema;
  const graph = neo4j.driver(config.neo4jUri, neo4j.auth.basic(config.neo4jUser, config.neo4jPassword), { connectionTimeout: 1_000, connectionAcquisitionTimeout: 1_000, maxTransactionRetryTime: 0 });
  const redis = new Redis(config.redisUrl, { lazyConnect: true, connectTimeout: 1_000, retryStrategy: () => null, maxRetriesPerRequest: 0 });
  redis.on("error", () => {});
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  let graphReady = false;
  async function close() {
    await app?.close();
    if (graphReady) {
      const session = graph.session();
      try { await session.run("MATCH (n:ProspectingFixture {fixtureTag: $tag}) DETACH DELETE n", { tag }); } finally { await session.close(); }
    }
    await graph.close(); redis.disconnect(); await database.close();
  }
  try {
    await graph.verifyConnectivity(); graphReady = true; await redis.connect(); await redis.ping();
    await database.pg.query(`CREATE TABLE platform_operators (id text PRIMARY KEY, email text UNIQUE NOT NULL, role text NOT NULL, auth_version integer NOT NULL DEFAULT 0, disabled_at timestamptz);
      CREATE TABLE platform_auth_sessions (id text PRIMARY KEY, family_id text NOT NULL, operator_id text NOT NULL REFERENCES platform_operators(id) ON DELETE CASCADE, auth_version integer NOT NULL, refresh_expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());`);
    const repository = new FixtureOperatorRepository(database.pg);
    const operatorJwt = new PlatformJwtService(repository, "prospecting-local-fixture-only-jwt-secret-20261120", 3600);
    const operators: Record<string, { id: string; email: string; role: PlatformOperator["role"]; token: string }> = {};
    for (const [name, role] of [["admin", "platform_admin"], ["billing", "billing_ops"], ["support", "support_ops"], ["auditor", "auditor"]] as const) {
      const id = `${tag}_${name}`; const email = `${id}@prospecting.test`;
      await database.pg.query("INSERT INTO platform_operators(id,email,role) VALUES ($1,$2,$3)", [id, email, role]);
      operators[name] = { id, email, role, token: await operatorJwt.issue({ operatorId: id, email, role }, 0) };
    }
    class FixtureModule {}
    Module({ controllers: [FixtureController, ...options.controllers ?? []], providers: [
      { provide: PROSPECTING_FIXTURE_PG, useValue: database.pg },
      { provide: PlatformJwtService, useValue: operatorJwt },
      { provide: PlatformAccessGuard, useValue: new PlatformAccessGuard(operatorJwt) },
      { provide: PlatformPermissionGuard, useValue: new PlatformPermissionGuard(new Reflector()) },
      ...options.providers ?? [],
    ] })(FixtureModule);
    app = await NestFactory.create(FixtureModule, { logger: false }); app.setGlobalPrefix("v1");
    app.enableCors({ origin: /^http:\/\/127\.0\.0\.1:\d+$/, credentials: true });
    await app.listen(options.port ?? 0, "127.0.0.1");
    return { ...database, tag, config, neo4j: graph, redis, app, url: await app.getUrl(), operatorJwt, operators, ports: { meta: capturedPort(), llm: capturedPort(), payment: capturedPort() }, close };
  } catch (error) { await close(); throw new Error("prospecting_fixture_dependency_unavailable:runtime", { cause: error }); }
}
