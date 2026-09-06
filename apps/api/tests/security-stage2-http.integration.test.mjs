import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Controller, Get, Module, UseGuards } from "@nestjs/common";
import { APP_GUARD, NestFactory, Reflector } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";

const compiled = new URL("../../../.audit/verification/compiled/apps/api/src/", import.meta.url);
const { RateLimitGuard } = await import(new URL("shared/http/rate-limit.guard.js", compiled));
const { DistributedRateLimitStore } = await import(new URL("shared/http/rate-limit.store.js", compiled));
const { AuthGuard } = await import(new URL("modules/auth/presentation/auth.guard.js", compiled));
const { AuthCookieService } = await import(new URL("modules/auth/domain/services/auth-cookie.service.js", compiled));
const { JwtService } = await import(new URL("modules/auth/domain/services/jwt.service.js", compiled));
const { PrismaAuthRepository } = await import(new URL("modules/auth/infrastructure/prisma-auth.repository.js", compiled));
const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
const redisUrl = process.env.READY_PROD_TEST_REDIS_URL;
const httpTestScope = randomUUID();
if (!databaseUrl || !redisUrl) throw new Error("HTTP integration requires disposable PostgreSQL and Redis");
for (const url of [databaseUrl, redisUrl]) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
assert.equal(new URL(databaseUrl).pathname, "/ready_prod_test");

async function server(jwt, options = {}) {
  class Routes {
    public() { return { ok: true }; }
    private() { return { authenticated: true }; }
    health() { return { alive: true }; }
  }
  Controller()(Routes);
  for (const [method, route] of [["public", "public/:id"], ["private", "private"], ["health", "health"]]) {
    Get(route)(Routes.prototype, method, Object.getOwnPropertyDescriptor(Routes.prototype, method));
  }
  UseGuards(AuthGuard)(Routes.prototype, "private", Object.getOwnPropertyDescriptor(Routes.prototype, "private"));
  const store = new DistributedRateLimitStore({ redisUrl, production: true, ipMax: 100, tenantMax: 2, windowMs: 60_000, ...options });
  // Isolate only the key namespace; exercise the real shared Redis operation.
  const hit = store.hit.bind(store);
  store.hit = (key, limit, windowMs) => hit(`http-test:${httpTestScope}:${key}`, limit, windowMs);
  const cookies = new AuthCookieService();
  class HttpTestModule {}
  Module({ controllers: [Routes], providers: [
    AuthGuard,
    { provide: JwtService, useValue: jwt },
    { provide: AuthCookieService, useValue: cookies },
    { provide: APP_GUARD, useFactory: () => new RateLimitGuard(new Reflector(), store, jwt, cookies) },
  ] })(HttpTestModule);
  const app = await NestFactory.create(HttpTestModule, { logger: false, abortOnError: false });
  await app.listen(0, "127.0.0.1");
  return { url: await app.getUrl(), close: async () => { await app.close(); store.onModuleDestroy(); } };
}

test("real Nest HTTP rejects anonymous abuse across replicas despite forged forwarded IP and changing URL", async () => {
  const jwt = { authenticate: async () => { throw new Error("jwt_invalid_signature"); } };
  const replicas = await Promise.all([server(jwt, { ipMax: 3 }), server(jwt, { ipMax: 3 })]);
  try {
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const response = await fetch(`${replicas[i % 2].url}/public/${i}`, { headers: { "x-forwarded-for": `192.0.2.${i}` } });
      statuses.push(response.status);
      if (i === 3) assert.ok(Number(response.headers.get("retry-after")) > 0);
      await response.arrayBuffer();
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  } finally { await Promise.all(replicas.map((replica) => replica.close())); }
});

test("real Nest HTTP resolves session tenant before route guards and rejects revoked tokens on another replica", async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const repository = new PrismaAuthRepository(prisma);
  const jwt = new JwtService("stage2-http-test-secret-at-least-32-characters", 3600, repository);
  const merchantIds = [];
  const replicas = await Promise.all([server(jwt), server(jwt)]);
  try {
    async function credential() {
      const id = randomUUID();
      merchantIds.push(id);
      await prisma.merchant.create({ data: { id, name: "HTTP security fixture" } });
      const user = await prisma.merchantUser.create({ data: { merchantId: id, email: `${id}@example.test`, role: "owner" } });
      return jwt.issue({ userId: user.id, merchantId: id, email: user.email, role: "owner" }, user.authVersion);
    }
    const token = await credential();
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${replicas[i % 2].url}/private`, { headers: { cookie: `aacp_access_token=${token}` } });
      assert.equal(response.status, i < 2 ? 200 : 429);
      await response.arrayBuffer();
    }
    const other = await credential();
    const before = await fetch(`${replicas[0].url}/private`, { headers: { authorization: `Bearer ${other}` } });
    assert.equal(before.status, 200);
    await before.arrayBuffer();
    await jwt.revoke(other);
    const after = await fetch(`${replicas[1].url}/private`, { headers: { authorization: `Bearer ${other}` } });
    assert.equal(after.status, 401);
    await after.arrayBuffer();
  } finally {
    await Promise.all(replicas.map((replica) => replica.close()));
    await prisma.merchantUser.deleteMany({ where: { merchantId: { in: merchantIds } } });
    await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    await prisma.$disconnect();
  }
});

test("real Nest HTTP returns 503 when quota storage fails while health remains available", async () => {
  const app = await server({}, { redisUrl: "redis://127.0.0.1:1" });
  try {
    const failure = await fetch(`${app.url}/public/item`);
    assert.equal(failure.status, 503);
    assert.equal((await failure.json()).code, "rate_limit_unavailable");
    const health = await fetch(`${app.url}/health`);
    assert.equal(health.status, 200);
    await health.arrayBuffer();
  } finally { await app.close(); }
});
