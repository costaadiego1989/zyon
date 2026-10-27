import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { MetricsController } from "./metrics.controller.js";
import { MetricsService } from "./metrics.service.js";

describe("MetricsController", () => {
  it("requires an ops secret in production", async (t) => {
    const previousEnv = process.env.NODE_ENV;
    const previousSecret = process.env.OPS_SHARED_SECRET;
    t.after(() => restoreEnv(previousEnv, previousSecret));
    process.env.NODE_ENV = "production";
    process.env.OPS_SHARED_SECRET = "ops-secret";

    const ctrl = new MetricsController(new MetricsService());
    await assert.rejects(
      () => ctrl.getMetrics(undefined, "wrong", fakeResponse() as unknown as Response),
      UnauthorizedException,
    );
  });

  it("allows bearer ops secret in production", async (t) => {
    const previousEnv = process.env.NODE_ENV;
    const previousSecret = process.env.OPS_SHARED_SECRET;
    t.after(() => restoreEnv(previousEnv, previousSecret));
    process.env.NODE_ENV = "production";
    process.env.OPS_SHARED_SECRET = "ops-secret";

    const res = fakeResponse();
    const ctrl = new MetricsController(new MetricsService());
    await ctrl.getMetrics("Bearer ops-secret", undefined, res as unknown as Response);
    assert.match(res.body, /checkout_started_total/);
  });
});

function fakeResponse(): { body: string; send(body: string): void } {
  return {
    body: "",
    send(body: string) {
      this.body = body;
    },
  };
}

function restoreEnv(nodeEnv: string | undefined, secret: string | undefined): void {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (secret === undefined) delete process.env.OPS_SHARED_SECRET;
  else process.env.OPS_SHARED_SECRET = secret;
}
