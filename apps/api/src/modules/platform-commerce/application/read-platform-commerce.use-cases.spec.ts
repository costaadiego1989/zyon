import assert from "node:assert/strict";
import test from "node:test";
import { ReadPlatformCommerceUseCases } from "./read-platform-commerce.use-cases.js";

class Repository {
  listInput: unknown;
  audit: any[] = [];
  async listOrders(input: unknown) { this.listInput = input; return { items: [] }; }
  async findOrder() { return undefined; }
  async merchantDetail() { return undefined; }
  async merchantRanking() { return []; }
  async recordRead(input: unknown) { this.audit.push(input); }
}
const context = { actorOperatorId: "operator_a", correlationId: "correlation_a", environment: "production" };

test("normalizes order filters and audits only filter facts, never the search text", async () => {
  const repository = new Repository(); const useCases = new ReadPlatformCommerceUseCases(repository as never);
  await useCases.listOrders({ from: "2026-09-01T03:00:00.000Z", to: "2026-09-03T03:00:00.000Z", query: "buyer@example.com", status: "approved", limit: "20" }, context);
  assert.equal((repository.listInput as { limit: number }).limit, 20);
  const detail = repository.audit[0].details;
  assert.equal(detail.hasSearch, true);
  assert.equal(JSON.stringify(detail).includes("buyer@example.com"), false);
});

test("rejects periods longer than one year before querying commerce data", async () => {
  const repository = new Repository(); const useCases = new ReadPlatformCommerceUseCases(repository as never);
  await assert.rejects(() => useCases.listOrders({ from: "2025-01-01T00:00:00.000Z", to: "2026-01-03T00:00:00.000Z" }, context), /platform_orders_invalid_period/);
  assert.equal(repository.listInput, undefined);
});

test("reserves merchant ranking reads for a bounded, audited period", async () => {
  const repository = new Repository(); const useCases = new ReadPlatformCommerceUseCases(repository as never);
  await useCases.merchantRanking({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-03T00:00:00.000Z", sort: "ai_cost", limit: "5" }, context);
  assert.equal(repository.audit[0].action, "merchant_ranking");
  assert.equal(repository.audit[0].details.sort, "ai_cost");
  assert.equal(repository.audit[0].details.limit, 5);
});
