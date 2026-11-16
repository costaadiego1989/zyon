import assert from "node:assert/strict";
import test from "node:test";
import { ListPlatformOperatorDirectoryUseCase } from "./list-platform-operator-directory.use-case.js";
import type { PlatformOperatorAccessCommand } from "../../platform-control/domain/platform-operator-access.js";
import type {
  PlatformOperatorDirectoryPage,
  PlatformOperatorDirectoryQuery,
  PlatformOperatorDirectoryReadAudit,
  PlatformOperatorDirectoryRepository,
} from "../domain/ports/platform-operator-directory-repository.port.js";

test("lists platform operators with only their derived permissions and records a privacy-safe audit", async () => {
  const repository = new InMemoryPlatformOperatorDirectoryRepository();
  const useCase = new ListPlatformOperatorDirectoryUseCase(repository);

  const page = await useCase.execute({
    query: "  ops@zyon.test ",
    role: "support_ops",
    status: "active",
    limit: "25",
  }, auditContext());

  assert.deepEqual(repository.query, {
    query: "ops@zyon.test",
    cursor: undefined,
    limit: 25,
    role: "support_ops",
    status: "active",
  });
  assert.deepEqual(page.items[0]?.permissions, [
    "platform:support:read",
    "platform:support:write",
    "platform:overview:read",
    "platform:merchants:read",
    "platform:feedback:read",
    "platform:feedback:write",
  ]);
  assert.equal("passwordHash" in (page.items[0] ?? {}), false);
  assert.equal("authVersion" in (page.items[0] ?? {}), false);
  assert.deepEqual(repository.readAudit, {
    ...auditContext(),
    returnedItems: 1,
    totalOperators: 2,
    limit: 25,
    searchApplied: true,
    roleFilterApplied: true,
    statusFilterApplied: true,
  });
});

test("rejects unknown roles before reading the operator directory", async () => {
  const repository = new InMemoryPlatformOperatorDirectoryRepository();
  const useCase = new ListPlatformOperatorDirectoryUseCase(repository);

  await assert.rejects(() => useCase.execute({ role: "merchant_admin" }, auditContext()), /platform_operators_invalid_role/);
  assert.equal(repository.query, undefined);
});

test("does not return operator identities if recording the audited read fails", async () => {
  const repository = new InMemoryPlatformOperatorDirectoryRepository();
  repository.auditFailure = new Error("audit_unavailable");
  const useCase = new ListPlatformOperatorDirectoryUseCase(repository);

  await assert.rejects(() => useCase.execute({}, auditContext()), /audit_unavailable/);
});

class InMemoryPlatformOperatorDirectoryRepository implements PlatformOperatorDirectoryRepository {
  query?: PlatformOperatorDirectoryQuery;
  readAudit?: PlatformOperatorDirectoryReadAudit;
  auditFailure?: Error;

  async list(input: PlatformOperatorDirectoryQuery): Promise<PlatformOperatorDirectoryPage> {
    this.query = input;
    return {
      summary: { total: 2, active: 1, disabled: 1 },
      items: [{
        id: "operator_1",
        email: "ops@zyon.test",
        role: "support_ops",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-15T00:00:00.000Z"),
      }],
    };
  }

  async recordRead(input: PlatformOperatorDirectoryReadAudit): Promise<void> {
    if (this.auditFailure) throw this.auditFailure;
    this.readAudit = input;
  }

  async executeAccessCommand(_input: PlatformOperatorAccessCommand): Promise<PlatformOperatorDirectoryEntry> {
    throw new Error("not_implemented");
  }
}

function auditContext() {
  return {
    actorOperatorId: "operator_2",
    correlationId: "corr_1",
    environment: "test",
  };
}
