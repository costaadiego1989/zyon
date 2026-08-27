import test from "node:test";
import assert from "node:assert/strict";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { HttpException } from "@nestjs/common";

test("HealthController.check returns {status:'ok', db:true, redis:boolean|'not_configured', uptime, timestamp:ISO} when DB is up", async () => {
  const mockRedis = {
    ping: async () => "PONG",
  };
  const service = new HealthService(
    { $queryRaw: async () => [{ "1": 1 }] } as never,
    mockRedis
  );
  const controller = new HealthController(service);

  const result = await controller.check();

  assert.equal(result.status, "ok");
  assert.equal(result.db, true);
  assert.ok(result.redis === true || result.redis === false || result.redis === "not_configured");
  assert.ok(typeof result.uptime === "number");
  assert.ok(result.uptime > 0);
  assert.ok(typeof result.timestamp === "string");
  assert.doesNotThrow(() => new Date(result.timestamp).toISOString());
  assert.equal(new Date(result.timestamp).toISOString(), result.timestamp);
});

test("HealthController.check throws 503 {status:'degraded', db:false} when DB ping fails", async () => {
  const service = new HealthService(
    {
      $queryRaw: async () => {
        throw new Error("connection refused");
      },
    } as never,
    null
  );
  const controller = new HealthController(service);

  await assert.rejects(
    controller.check(),
    (err: unknown) => {
      assert.ok(err instanceof HttpException);
      const response = err.getResponse() as Record<string, unknown>;
      assert.equal(err.getStatus(), 503);
      assert.equal(response.status, "degraded");
      assert.equal(response.db, false);
      return true;
    }
  );
});

test("HealthService.check returns status:'ok' when DB is up", async () => {
  const service = new HealthService(
    { $queryRaw: async () => [{ "1": 1 }] } as never,
    null
  );

  const result = await service.check();

  assert.equal(result.status, "ok");
  assert.equal(result.db, true);
  assert.equal(result.redis, "not_configured");
});

test("HealthService.check returns status:'degraded' when DB is down", async () => {
  const service = new HealthService(
    {
      $queryRaw: async () => {
        throw new Error("db down");
      },
    } as never,
    null
  );

  const result = await service.check();

  assert.equal(result.status, "degraded");
  assert.equal(result.db, false);
  assert.equal(result.redis, "not_configured");
});

test("HealthService.check returns redis:true when Redis is available", async () => {
  const mockRedis = {
    ping: async () => "PONG",
  };
  const service = new HealthService(
    { $queryRaw: async () => [{ "1": 1 }] } as never,
    mockRedis
  );

  const result = await service.check();

  assert.equal(result.redis, true);
});

test("HealthService.check returns redis:false when Redis ping fails", async () => {
  const mockRedis = {
    ping: async () => {
      throw new Error("redis down");
    },
  };
  const service = new HealthService(
    { $queryRaw: async () => [{ "1": 1 }] } as never,
    mockRedis
  );

  const result = await service.check();

  assert.equal(result.redis, false);
});