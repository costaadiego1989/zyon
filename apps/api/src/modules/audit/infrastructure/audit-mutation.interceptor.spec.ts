/**
 * Regression tests for AuditMutationInterceptor:
 *  - P2: errors are logged, not silently swallowed
 *  - P3: idempotent replays (Idempotency-Replayed header) are skipped
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { of } from "rxjs";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { AuditMutationInterceptor } from "./audit-mutation.interceptor.js";
import type { RecordAuditEventUseCase } from "../application/audit.use-cases.js";
import type { MerchantAuditEvent } from "../domain/ports/audit-repository.port.js";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";

const PRINCIPAL: TenantPrincipal = {
  kind: "service",
  tenantId: "mrc_a",
  credentialId: "key_1",
  environment: "test",
  scopes: [],
};

function makeContext(
  method: string,
  path: string,
  principal: TenantPrincipal | undefined,
  responseHeaders: Record<string, string> = {},
): ExecutionContext {
  const headers: Record<string, string> = { ...responseHeaders };
  const response = {
    getHeader: (name: string) => headers[name],
  };
  const request = {
    tenantPrincipal: principal,
    method,
    path,
    route: undefined,
    params: {},
    baseUrl: "",
    correlationId: undefined,
  };
  return {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(): CallHandler {
  return { handle: () => of({ ok: true }) };
}

describe("AuditMutationInterceptor", () => {
  it("P3 — skips audit recording when Idempotency-Replayed header is set", async () => {
    let recordCalled = false;
    const record: RecordAuditEventUseCase = {
      execute: async () => {
        recordCalled = true;
        return {} as MerchantAuditEvent;
      },
    } as unknown as RecordAuditEventUseCase;

    const interceptor = new AuditMutationInterceptor(record);
    const ctx = makeContext("POST", "/installations", PRINCIPAL, {
      "Idempotency-Replayed": "true",
    });

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, makeHandler()).subscribe({ complete: resolve });
    });

    // Allow micro-task queue to flush any pending async work.
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(recordCalled, false, "audit must not record on replay");
  });

  it("P2 — audit failure is logged (does not throw or reject the response)", async () => {
    const errors: unknown[] = [];
    const record: RecordAuditEventUseCase = {
      execute: async () => {
        throw new Error("db_unavailable");
      },
    } as unknown as RecordAuditEventUseCase;

    const interceptor = new AuditMutationInterceptor(record);
    // Override logger to capture errors.
    (interceptor as any).logger = {
      error: (msg: string) => errors.push(msg),
    };

    const ctx = makeContext("POST", "/installations", PRINCIPAL);

    let responseReceived = false;
    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(ctx, makeHandler()).subscribe({
        next: () => { responseReceived = true; },
        error: reject,
        complete: resolve,
      });
    });

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(responseReceived, true, "response must still be emitted");
    assert.ok(errors.length > 0, "error must be logged");
  });

  it("non-mutation methods are passed through without recording", async () => {
    let recordCalled = false;
    const record: RecordAuditEventUseCase = {
      execute: async () => {
        recordCalled = true;
        return {} as MerchantAuditEvent;
      },
    } as unknown as RecordAuditEventUseCase;

    const interceptor = new AuditMutationInterceptor(record);
    const ctx = makeContext("GET", "/installations", PRINCIPAL);

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, makeHandler()).subscribe({ complete: resolve });
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(recordCalled, false, "GET must not produce an audit event");
  });
});
