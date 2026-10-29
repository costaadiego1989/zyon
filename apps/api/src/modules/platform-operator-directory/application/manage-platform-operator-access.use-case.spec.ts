import assert from "node:assert/strict";
import test from "node:test";
import { ManagePlatformOperatorAccessUseCase } from "./manage-platform-operator-access.use-case.js";
import type { PlatformOperatorAccessCommand } from "../../platform-control/domain/platform-operator-access.js";
import type {
  PlatformOperatorDirectoryEntry,
  PlatformOperatorDirectoryPage,
  PlatformOperatorDirectoryQuery,
  PlatformOperatorDirectoryReadAudit,
  PlatformOperatorDirectoryRepository,
} from "../domain/ports/platform-operator-directory-repository.port.js";

test("normalizes a role change before it reaches the operator repository", async () => {
  const repository = new InMemoryOperatorRepository();
  const useCase = new ManagePlatformOperatorAccessUseCase(repository);

  const result = await useCase.execute({
    actorOperatorId: " operator_admin ",
    targetOperatorId: " operator_support ",
    action: "change_role",
    role: "support_ops",
    correlationId: " correlation_1 ",
    environment: "test",
  });

  assert.equal(result.id, "operator_support");
  assert.deepEqual(repository.command, {
    actorOperatorId: "operator_admin",
    targetOperatorId: "operator_support",
    action: "change_role",
    role: "support_ops",
    correlationId: "correlation_1",
    environment: "test",
  });
});

test("rejects invalid or ambiguous operator commands before mutation", async () => {
  const repository = new InMemoryOperatorRepository();
  const useCase = new ManagePlatformOperatorAccessUseCase(repository);
  const context = {
    actorOperatorId: "operator_admin",
    targetOperatorId: "operator_support",
    correlationId: "correlation_1",
    environment: "test",
  };

  await assert.rejects(() => useCase.execute({ ...context, action: "change_role" }), /platform_operator_invalid_role/);
  await assert.rejects(() => useCase.execute({ ...context, action: "disable", role: "support_ops" }), /platform_operator_unexpected_role/);
  await assert.rejects(() => useCase.execute({ ...context, action: "unknown" }), /platform_operator_invalid_action/);
  assert.equal(repository.command, undefined);
});

class InMemoryOperatorRepository implements PlatformOperatorDirectoryRepository {
  command?: unknown;

  async list(_input: PlatformOperatorDirectoryQuery): Promise<PlatformOperatorDirectoryPage> {
    return { items: [], summary: { total: 0, active: 0, disabled: 0 } };
  }

  async recordRead(_input: PlatformOperatorDirectoryReadAudit): Promise<void> {}

  async executeAccessCommand(input: PlatformOperatorAccessCommand): Promise<PlatformOperatorDirectoryEntry> {
    this.command = input;
    return {
      id: "operator_support",
      email: "support@zyon.test",
      role: "support_ops",
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
      updatedAt: new Date("2026-09-15T00:00:00.000Z"),
    };
  }
}
