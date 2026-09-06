import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthCookieService } from "../../modules/auth/domain/services/auth-cookie.service.js";
import type { JwtService } from "../../modules/auth/domain/services/jwt.service.js";
import { RateLimit, RateLimitGuard } from "./rate-limit.guard.js";
import { DistributedRateLimitStore, resolveQuotaOptions } from "./rate-limit.store.js";

class ExampleController { resource() {} }
function context(overrides: Record<string, unknown> = {}, handler = ExampleController.prototype.resource) {
  const headers = new Map<string, string>();
  const request = { headers: {}, path: "/items/1", ip: "192.0.2.1", ...overrides };
  const response = { setHeader: (name: string, value: string) => headers.set(name, value) };
  const value = { getType: () => "http", getHandler: () => handler, getClass: () => ExampleController,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as unknown as ExecutionContext;
  return { value, request, headers };
}
function setup(ipMax = 2, tenantMax = 2) {
  const store = new DistributedRateLimitStore({ production: false, ipMax, tenantMax, windowMs: 60_000 });
  const jwt = { authenticate: async (token: string) => {
    if (token === "infrastructure") throw new Error("database_offline");
    if (!token.startsWith("valid:")) throw new Error("jwt_invalid_signature");
    return { merchantId: token.slice(6) };
  } } as unknown as JwtService;
  return { store, guard: new RateLimitGuard(new Reflector(), store, jwt, new AuthCookieService()) };
}
function status(code: number) { return (error: unknown) => error instanceof HttpException && error.getStatus() === code; }

test("anonymous quota is enforced before auth and ignores forged forwarded IP, tenant and billing tier", async () => {
  const { guard } = setup();
  for (let i = 0; i < 2; i++) await guard.canActivate(context({ headers: { "x-forwarded-for": `198.51.100.${i}` }, tenantPrincipal: { tenantId: `${i}` }, billingTier: "enterprise" }).value);
  const blocked = context({ headers: { "x-forwarded-for": "203.0.113.44" }, path: "/items/another?cache=2" });
  await assert.rejects(guard.canActivate(blocked.value), status(429));
  assert.equal(blocked.headers.get("X-RateLimit-Remaining"), "0");
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  await guard.canActivate(context({ ip: "192.0.2.2" }).value);
});

test("verified tenant quota spans different IPs before any route guard assigns principal", async () => {
  const { guard } = setup(100, 2);
  await guard.canActivate(context({ ip: "192.0.2.1", headers: { authorization: "Bearer valid:A" } }).value);
  await guard.canActivate(context({ ip: "192.0.2.2", headers: { cookie: "aacp_access_token=valid:A" } }).value);
  await assert.rejects(guard.canActivate(context({ ip: "192.0.2.3", headers: { authorization: "Bearer valid:A" } }).value), status(429));
  const other = context({ ip: "192.0.2.3", headers: { authorization: "Bearer valid:B" } });
  await guard.canActivate(other.value);
  assert.equal((other.request as any).tenantPrincipal, undefined);
});

test("invalid tokens consume IP quota, database failure returns 503", async () => {
  const { guard } = setup(1);
  await guard.canActivate(context({ headers: { authorization: "Bearer invalid" } }).value);
  await assert.rejects(guard.canActivate(context({ headers: { authorization: "Bearer another" } }).value), status(429));
  await assert.rejects(guard.canActivate(context({ ip: "192.0.2.9", headers: { authorization: "Bearer infrastructure" } }).value), status(503));
});

test("store errors fail closed and health probes remain available", async () => {
  const { guard, store } = setup();
  store.hit = async () => { throw new Error("redis_unavailable"); };
  await assert.rejects(guard.canActivate(context().value), status(503));
  assert.equal(await guard.canActivate(context({ path: "/health" }).value), true);
  await assert.rejects(guard.canActivate(context({ path: "/health/other" }).value), status(503));
});

test("route quotas cannot be bypassed by changing resource IDs", async () => {
  class Limited { @RateLimit(1) resource() {} }
  const { guard } = setup(100);
  await guard.canActivate(context({ path: "/items/1" }, Limited.prototype.resource).value);
  await assert.rejects(guard.canActivate(context({ path: "/items/2" }, Limited.prototype.resource).value), status(429));
});

test("production requires Redis and invalid numeric quota config is rejected", () => {
  assert.throws(() => new DistributedRateLimitStore({ production: true, ipMax: 1, tenantMax: 1, windowMs: 1 }), /requires_redis/);
  assert.throws(() => resolveQuotaOptions({ RATE_LIMIT_MAX: "0" }), /invalid_rate_limit_configuration/);
  assert.throws(() => RateLimit(-1), /invalid_route_rate_limit/);
});
