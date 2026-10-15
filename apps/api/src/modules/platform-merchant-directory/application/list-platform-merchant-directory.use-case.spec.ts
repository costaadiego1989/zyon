import assert from "node:assert/strict";
import test from "node:test";
import { ListPlatformMerchantDirectoryUseCase } from "./list-platform-merchant-directory.use-case.js";
import type {
  PlatformMerchantDirectoryPage,
  PlatformMerchantDirectoryQuery,
  PlatformMerchantDirectoryReadAudit,
  PlatformMerchantDirectoryRepository,
} from "../domain/ports/platform-merchant-directory-repository.port.js";

test("searches the global merchant directory and records a privacy-safe read audit", async () => {
  const repository = new InMemoryMerchantDirectoryRepository();
  const useCase = new ListPlatformMerchantDirectoryUseCase(repository);

  const page = await useCase.execute({ query: "  zyon  ", limit: "25" }, auditContext());

  assert.equal(page.items.length, 1);
  assert.deepEqual(repository.query, { query: "zyon", cursor: undefined, limit: 25 });
  assert.deepEqual(repository.readAudit, {
    ...auditContext(),
    itemCount: 1,
    limit: 25,
    searchApplied: true,
  });
  assert.equal("query" in (repository.readAudit ?? {}), false);
});

test("rejects an oversized directory search before reading merchants", async () => {
  const repository = new InMemoryMerchantDirectoryRepository();
  const useCase = new ListPlatformMerchantDirectoryUseCase(repository);

  await assert.rejects(
    () => useCase.execute({ query: "x".repeat(121) }, auditContext()),
    /platform_merchants_invalid_query/,
  );
  assert.equal(repository.query, undefined);
});

test("does not return merchants if the read audit cannot be persisted", async () => {
  const repository = new InMemoryMerchantDirectoryRepository();
  repository.auditFailure = new Error("audit_unavailable");
  const useCase = new ListPlatformMerchantDirectoryUseCase(repository);

  await assert.rejects(() => useCase.execute({}, auditContext()), /audit_unavailable/);
});

class InMemoryMerchantDirectoryRepository implements PlatformMerchantDirectoryRepository {
  query?: PlatformMerchantDirectoryQuery;
  readAudit?: PlatformMerchantDirectoryReadAudit;
  auditFailure?: Error;

  async list(input: PlatformMerchantDirectoryQuery): Promise<PlatformMerchantDirectoryPage> {
    this.query = input;
    return {
      items: [{
        id: "merchant_1",
        name: "Zyon Store",
        storeSlug: "zyon-store",
        plan: "BOTH",
        memberCount: 2,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-15T00:00:00.000Z"),
      }],
    };
  }

  async recordRead(input: PlatformMerchantDirectoryReadAudit): Promise<void> {
    if (this.auditFailure) throw this.auditFailure;
    this.readAudit = input;
  }
}

function auditContext() {
  return {
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
  };
}
