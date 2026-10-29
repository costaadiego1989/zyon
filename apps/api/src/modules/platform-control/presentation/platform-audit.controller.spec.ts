import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { PlatformAuditController } from "./platform-audit.controller.js";
import { setPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

test("maps invalid audit filters to HTTP 400 after platform authentication", async () => {
  const controller = new PlatformAuditController({
    execute: async () => { throw new Error("platform_audit_invalid_period"); },
  } as never);
  const request: PlatformPrincipalRequest & { correlationId?: string } = { correlationId: "corr_1" };
  setPlatformPrincipal(request, { operatorId: "operator_1", email: "operator@example.com", role: "auditor" });
  await assert.rejects(
    () => controller.list({ from: "2026-09-01T00:00:00.000Z" }, request),
    error => error instanceof BadRequestException && error.getStatus() === 400,
  );
});
