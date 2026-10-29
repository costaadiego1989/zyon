import assert from "node:assert/strict";
import test from "node:test";
import { PlatformInfrastructureController } from "./platform-infrastructure.controller.js";
import { setPlatformPrincipal, type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";

test("passes the platform operator audit context to the readiness use case", async () => {
  const calls: unknown[] = [];
  const controller = new PlatformInfrastructureController({
    execute: async (input: unknown) => {
      calls.push(input);
      return { readiness: { status: "ready" } };
    },
  } as never);
  const request: PlatformPrincipalRequest & { correlationId?: string } = { correlationId: "corr_1" };
  setPlatformPrincipal(request, {
    operatorId: "operator_1",
    email: "infra@example.com",
    role: "infra_ops",
  });

  const result = await controller.getReadiness(request);

  assert.deepEqual(result, { readiness: { status: "ready" } });
  assert.deepEqual(calls, [{
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
  }]);
});
