import test from "node:test";
import assert from "node:assert/strict";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { HttpException } from "@nestjs/common";

test("HealthController.liveness returns {status:'ok', timestamp:ISO}", () => {
  const service = new HealthService({
    $queryRaw: async () => undefined
  } as never);
  const controller = new HealthController(service);

  const result = controller.liveness();

  assert.equal(result.status, "ok");
  assert.ok(typeof result.timestamp === "string");
  assert.doesNotThrow(() => new Date(result.timestamp).toISOString());
  assert.equal(new Date(result.timestamp).toISOString(), result.timestamp);
});

test("HealthController.liveness emits a fresh timestamp per call", async () => {
  const service = new HealthService({
    $queryRaw: async () => undefined
  } as never);
  const controller = new HealthController(service);

  const first = controller.liveness();
  await new Promise((r) => setTimeout(r, 5));
  const second = controller.liveness();

  assert.notEqual(first.timestamp, second.timestamp);
});

test("HealthController.readiness returns 200 {status:'ready', db:'connected'} when DB is up", async () => {
  const service = new HealthService({
    $queryRaw: async () => [{ "1": 1 }]
  } as never);
  const controller = new HealthController(service);

  const result = await controller.readiness();

  assert.deepEqual(result, { status: "ready", db: "connected" });
});

test("HealthController.readiness throws 503 {status:'unavailable', db:'disconnected'} when DB ping fails", async () => {
  const service = new HealthService({
    $queryRaw: async () => {
      throw new Error("connection refused");
    }
  } as never);
  const controller = new HealthController(service);

  await assert.rejects(
    controller.readiness(),
    (err: unknown) => {
      assert.ok(err instanceof HttpException);
      const response = err.getResponse() as Record<string, unknown>;
      assert.equal(err.getStatus(), 503);
      assert.equal(response.status, "unavailable");
      assert.equal(response.db, "disconnected");
      return true;
    }
  );
});

test("HealthService.readiness returns ready:true on success", async () => {
  const service = new HealthService({
    $queryRaw: async () => undefined
  } as never);

  const result = await service.readiness();

  assert.deepEqual(result, { ready: true, db: "connected" });
});

test("HealthService.readiness returns ready:false when query rejects", async () => {
  const service = new HealthService({
    $queryRaw: async () => {
      throw new Error("db down");
    }
  } as never);

  const result = await service.readiness();

  assert.deepEqual(result, { ready: false, db: "disconnected" });
});