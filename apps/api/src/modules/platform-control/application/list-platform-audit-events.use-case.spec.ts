import assert from "node:assert/strict";
import test from "node:test";
import { ListPlatformAuditEventsUseCase } from "./list-platform-audit-events.use-case.js";
import type { PlatformAuditEvent } from "../domain/platform-audit.js";
import type {
  PlatformAuditPage,
  PlatformAuditQuery,
  PlatformAuditReadAudit,
  PlatformAuditRepository,
} from "../domain/ports/platform-audit-repository.port.js";

test("lists a deterministic filtered audit page, sanitizes details, and records the read", async () => {
  const repository = new InMemoryPlatformAuditRepository();
  const useCase = new ListPlatformAuditEventsUseCase(repository);
  const result = await useCase.execute({
    action: "feedback.queue.read",
    actor_operator_id: "operator_2",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-02T00:00:00.000Z",
    limit: "1",
  }, auditContext());

  assert.deepEqual(repository.query, {
    limit: 1,
    action: "feedback.queue.read",
    actorOperatorId: "operator_2",
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-09-02T00:00:00.000Z"),
  });
  assert.deepEqual(result.filters, {
    action: "feedback.queue.read",
    actor_operator_id: "operator_2",
    range: {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-02T00:00:00.000Z",
      timezone: "UTC",
      end_exclusive: true,
    },
  });
  assert.equal(result.coverage.audit_event_storage.status, "available");
  assert.deepEqual(result.items[0], {
    id: "audit_2",
    occurred_at: "2026-09-01T12:00:00.000Z",
    action: "feedback.queue.read",
    outcome: "succeeded",
    actor_operator_id: "operator_2",
    actor_operator_email: "operator@example.com",
    actor_operator_role: "auditor",
    permission: "platform:feedback:read",
    environment: "test",
    target_type: "platform_feedback_queue",
    correlation_id: "corr_event",
    details: { source: "merchant_feedback", returnedItems: 1, noteAdded: false },
  });
  assert.ok(result.next_cursor);
  assert.deepEqual(repository.audit, {
    ...auditContext(),
    returnedItems: 1,
    limit: 1,
    actionFilterApplied: true,
    actorFilterApplied: true,
    dateRangeApplied: true,
    cursorApplied: false,
  });
});

test("requires a cursor to be reused with the exact normalized filters", async () => {
  const repository = new InMemoryPlatformAuditRepository();
  const useCase = new ListPlatformAuditEventsUseCase(repository);
  const first = await useCase.execute({ action: "feedback.queue.read" }, auditContext());
  await useCase.execute({ action: "feedback.queue.read", cursor: first.next_cursor }, auditContext());
  assert.deepEqual(repository.query?.cursor, {
    occurredAt: new Date("2026-09-01T12:00:00.000Z"),
    id: "audit_2",
  });
  await assert.rejects(
    () => useCase.execute({ action: "feedback.detail.read", cursor: first.next_cursor }, auditContext()),
    /platform_audit_invalid_cursor/,
  );
});

test("rejects partial, non-UTC, and overlong ranges before reading or auditing", async () => {
  const repository = new InMemoryPlatformAuditRepository();
  const useCase = new ListPlatformAuditEventsUseCase(repository);
  await assert.rejects(
    () => useCase.execute({ from: "2026-09-01T00:00:00.000Z" }, auditContext()),
    /platform_audit_invalid_period/,
  );
  await assert.rejects(
    () => useCase.execute({
      from: "2026-09-01T00:00:00-03:00",
      to: "2026-09-02T00:00:00.000Z",
    }, auditContext()),
    /platform_audit_invalid_from/,
  );
  assert.equal(repository.query, undefined);
  assert.equal(repository.audit, undefined);
});

test("does not return audit history when recording the read fails", async () => {
  const repository = new InMemoryPlatformAuditRepository();
  repository.auditFailure = new Error("platform_audit_unavailable");
  const useCase = new ListPlatformAuditEventsUseCase(repository);
  await assert.rejects(() => useCase.execute({}, auditContext()), /platform_audit_unavailable/);
});

class InMemoryPlatformAuditRepository implements PlatformAuditRepository {
  query?: PlatformAuditQuery;
  audit?: PlatformAuditReadAudit;
  auditFailure?: Error;

  async list(input: PlatformAuditQuery): Promise<PlatformAuditPage> {
    this.query = input;
    return { items: [event()], nextCursor: { occurredAt: new Date("2026-09-01T12:00:00.000Z"), id: "audit_2" } };
  }

  async recordRead(input: PlatformAuditReadAudit): Promise<void> {
    if (this.auditFailure) throw this.auditFailure;
    this.audit = input;
  }
}

function event(): PlatformAuditEvent {
  return {
    id: "audit_2",
    actorOperatorId: "operator_2",
    action: "feedback.queue.read",
    permission: "platform:feedback:read",
    environment: "test",
    targetType: "platform_feedback_queue",
    correlationId: "corr_event",
    outcome: "succeeded",
    details: { source: "merchant_feedback", returnedItems: 1, noteAdded: false, note: "must_not_return", nested: { unsafe: true } },
    occurredAt: new Date("2026-09-01T12:00:00.000Z"),
    actor: { email: "operator@example.com", role: "auditor" },
  };
}

function auditContext() {
  return { actorOperatorId: "operator_1", correlationId: "corr_1", environment: "test" };
}
