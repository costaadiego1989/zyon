import assert from "node:assert/strict";
import test from "node:test";
import {
  decidePlatformOperatorAccessChange,
  type PlatformOperatorAccessCommand,
} from "./platform-operator-access.js";

const now = new Date("2026-09-15T12:00:00.000Z");

function command(action: PlatformOperatorAccessCommand["action"], role?: PlatformOperatorAccessCommand["role"]): PlatformOperatorAccessCommand {
  return {
    actorOperatorId: "operator_admin_1",
    targetOperatorId: "operator_admin_2",
    action,
    ...(role ? { role } : {}),
    correlationId: "correlation_1",
    environment: "test",
  };
}

function administrator(id: string) {
  return { id, role: "platform_admin" as const };
}

test("does not allow the last active platform administrator to be disabled or demoted", () => {
  const input = {
    actor: administrator("operator_admin_1"),
    target: administrator("operator_admin_2"),
    activePlatformAdminCount: 1,
    now,
  };

  assert.throws(() => decidePlatformOperatorAccessChange({ ...input, command: command("disable") }), /platform_operator_last_admin_protected/);
  assert.throws(() => decidePlatformOperatorAccessChange({ ...input, command: command("change_role", "auditor") }), /platform_operator_last_admin_protected/);
});

test("revokes sessions when access changes and prevents self-management", () => {
  const decision = decidePlatformOperatorAccessChange({
    actor: administrator("operator_admin_1"),
    target: { id: "operator_support", role: "support_ops" },
    command: { ...command("disable"), targetOperatorId: "operator_support" },
    activePlatformAdminCount: 2,
    now,
  });
  assert.deepEqual(decision.changes, { disabledAt: now });
  assert.equal(decision.details.sessionsRevoked, true);

  assert.throws(() => decidePlatformOperatorAccessChange({
    actor: administrator("operator_admin_1"),
    target: administrator("operator_admin_1"),
    command: { ...command("revoke_sessions"), targetOperatorId: "operator_admin_1" },
    activePlatformAdminCount: 2,
    now,
  }), /platform_operator_self_management_forbidden/);
});
