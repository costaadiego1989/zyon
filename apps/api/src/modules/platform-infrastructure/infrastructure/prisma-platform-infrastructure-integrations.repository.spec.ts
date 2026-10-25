import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPlatformInfrastructureIntegrationsRepository } from "./prisma-platform-infrastructure-integrations.repository.js";

test("returns only grouped persisted integration and ERP job states", async () => {
  const calls: string[] = [];
  const groupBy = (name: string, rows: unknown[]) => async (input: { by: string[] }) => {
    calls.push(`${name}:${input.by.join(",")}`);
    return rows;
  };
  const repository = new PrismaPlatformInfrastructureIntegrationsRepository({
    merchantCommerceConnection: {
      groupBy: groupBy("commerce", [{ provider: "shopify", status: "connected", _count: { _all: 2 } }]),
    },
    merchantPaymentConnection: {
      groupBy: groupBy("payments", [{ provider: "asaas", status: "active", _count: { _all: 3 } }]),
    },
    erpConnection: {
      groupBy: groupBy("erp", [{ provider: "omie", status: "error", _count: { _all: 1 } }]),
    },
    crmConnection: {
      groupBy: groupBy("crm", [{ provider: "hubspot", status: "connected", _count: { _all: 1 } }]),
    },
    erpSyncJob: {
      groupBy: groupBy("erp_jobs", [
        { status: "queued", _count: { _all: 4 } },
        { status: "completed", _count: { _all: 5 } },
      ]),
    },
  } as never);

  const result = await repository.snapshot();

  assert.deepEqual(calls.sort(), [
    "commerce:provider,status",
    "crm:provider,status",
    "erp:provider,status",
    "erp_jobs:status",
    "payments:provider,status",
  ]);
  assert.deepEqual(result, {
    connection_states: [
      { surface: "commerce", provider: "shopify", status: "connected", count: 2 },
      { surface: "crm", provider: "hubspot", status: "connected", count: 1 },
      { surface: "erp", provider: "omie", status: "error", count: 1 },
      { surface: "payments", provider: "asaas", status: "active", count: 3 },
    ],
    erp_sync_jobs: [
      { status: "completed", count: 5 },
      { status: "queued", count: 4 },
    ],
  });
});
