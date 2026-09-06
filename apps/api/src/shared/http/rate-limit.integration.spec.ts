import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Redis } from "ioredis";
import { HttpException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthCookieService } from "../../modules/auth/domain/services/auth-cookie.service.js";
import type { JwtService } from "../../modules/auth/domain/services/jwt.service.js";
import { DistributedRateLimitStore } from "./rate-limit.store.js";
import { RateLimitGuard } from "./rate-limit.guard.js";

const url = process.env.READY_PROD_TEST_REDIS_URL;
if (url && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Redis tests require a disposable loopback server");
function stores() {
  const options = { redisUrl: url, production: true, ipMax: 3, tenantMax: 2, windowMs: 60_000 };
  return [new DistributedRateLimitStore(options), new DistributedRateLimitStore(options)];
}

test("Redis admits exactly 10 of 100 simultaneous hits across two instances", { skip: !url }, async () => {
  const replicas = stores();
  const key = `test:${randomUUID()}`;
  try {
    const hits = await Promise.all(Array.from({ length: 100 }, (_, i) => replicas[i % 2].hit(key, 10, 60_000)));
    assert.equal(hits.filter((hit) => hit.allowed).length, 10);
    assert.equal(new Set(hits.filter((hit) => hit.allowed).map((hit) => hit.remaining)).size, 10);
  } finally { replicas.forEach((store) => store.onModuleDestroy()); }
});

test("Redis quota expires and atomically repairs missing TTL", { skip: !url }, async () => {
  const [store, other] = stores();
  const redis = new Redis(url!);
  const key = `test:${randomUUID()}`;
  const rawKey = `aacp:quota:v2:${key}`;
  try {
    await redis.set(rawKey, "1");
    assert.equal((await store.hit(key, 1, 60_000)).allowed, false);
    assert.ok(await redis.pttl(rawKey) > 0);
    await redis.pexpire(rawKey, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await other.hit(key, 1, 60_000)).allowed, true);
  } finally { await redis.del(rawKey); redis.disconnect(); store.onModuleDestroy(); other.onModuleDestroy(); }
});

test("two Redis-backed guards enforce anonymous and verified tenant quotas", { skip: !url }, async () => {
  class Example { get() {} }
  const replicas = stores();
  const jwt = { authenticate: async (token: string) => ({ merchantId: token }) } as unknown as JwtService;
  const guards = replicas.map((store) => new RateLimitGuard(new Reflector(), store, jwt, new AuthCookieService()));
  const make = (ip: string, token?: string) => ({ getType: () => "http", getHandler: () => Example.prototype.get, getClass: () => Example,
    switchToHttp: () => ({ getRequest: () => ({ path: "/items", ip, headers: token ? { authorization: `Bearer ${token}` } : {} }), getResponse: () => ({ setHeader() {} }) }),
  }) as unknown as ExecutionContext;
  const identity = randomUUID();
  try {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => guards[i % 2].canActivate(make(identity))));
    assert.equal(results.filter((value) => value.status === "fulfilled").length, 3);
    assert.ok(results.filter((value) => value.status === "rejected").every((value) => value.status === "rejected" && value.reason instanceof HttpException && value.reason.getStatus() === 429));
    const tenants = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => guards[i % 2].canActivate(make(`${identity}-${i}`, identity))));
    assert.equal(tenants.filter((value) => value.status === "fulfilled").length, 2);
  } finally { replicas.forEach((store) => store.onModuleDestroy()); }
});
