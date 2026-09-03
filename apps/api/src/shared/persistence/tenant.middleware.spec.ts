import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  injectMerchantId,
  injectMerchantIdIntoData,
  scopeTenantArgs,
  scopeTenantOperation,
  shouldInjectTenant,
  TENANT_SCOPED_MODELS,
  TENANT_SCOPED_READ_OPERATIONS,
  TENANT_SCOPED_WHERE_MUTATIONS,
  TENANT_SCOPED_WRITE_OPERATIONS,
} from "./tenant.middleware.js";

describe("registerTenantMiddleware", () => {
  it("scopes every tenant model across every supported operation", () => {
    const operations = [
      ...TENANT_SCOPED_READ_OPERATIONS,
      ...TENANT_SCOPED_WHERE_MUTATIONS,
      ...TENANT_SCOPED_WRITE_OPERATIONS,
    ];

    for (const model of TENANT_SCOPED_MODELS) {
      for (const operation of operations) {
        assert.equal(
          shouldInjectTenant(model, operation),
          true,
          `${model}.${operation} should be tenant-scoped`,
        );
      }
    }
  });

  it("does not scope obsolete models or unsupported operations", () => {
    for (const obsolete of [
      "Offer",
      "Order",
      "OutboxEvent",
      "BuyerAgentPreferences",
      "Payment",
    ]) {
      assert.equal(shouldInjectTenant(obsolete, "findMany"), false);
    }
    assert.equal(shouldInjectTenant("Merchant", "findMany"), false);
    assert.equal(shouldInjectTenant("CheckoutSession", "executeRaw"), false);
  });

  it("keeps the tenant model list aligned with prisma/schema.prisma", () => {
    const schemaPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../prisma/schema.prisma",
    );
    const schema = readFileSync(schemaPath, "utf8");
    const schemaTenantModels = [...schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s*merchantId\s+\w+/m.test(body))
      .map(([, model]) => model)
      .sort();

    assert.deepEqual(
      [...TENANT_SCOPED_MODELS].sort(),
      schemaTenantModels,
      "TENANT_SCOPED_MODELS must match every Prisma model containing merchantId",
    );
  });

  it("overrides hostile merchantId values in every read filter", () => {
    for (const operation of TENANT_SCOPED_READ_OPERATIONS) {
      const result = scopeTenantArgs(
        { where: { status: "open", merchantId: "mrc_hostile" } },
        operation,
        "mrc_1",
      );
      assert.deepEqual(
        result.where,
        { status: "open", merchantId: "mrc_1" },
        operation,
      );
    }
  });

  it("pins the tenant inside a composite unique key without adding a sibling merchantId", () => {
    // Prisma compound keys (e.g. @@unique([merchantId, orderId]) -> merchantId_orderId)
    // must stay a single nested identifier; a top-level merchantId would be invalid args.
    for (const operation of ["findUnique", "update", "delete", "upsert"]) {
      const result = scopeTenantArgs(
        {
          where: { merchantId_orderId: { merchantId: "mrc_hostile", orderId: "o1" } },
          ...(operation === "upsert" ? { create: { orderId: "o1" }, update: {} } : {}),
          ...(operation === "update" ? { data: { status: "x" } } : {}),
        },
        operation,
        "mrc_1",
      );
      assert.deepEqual(
        result.where,
        { merchantId_orderId: { merchantId: "mrc_1", orderId: "o1" } },
        `${operation}: composite key must be pinned to the caller tenant`,
      );
      assert.equal(
        (result.where as Record<string, unknown>).merchantId,
        undefined,
        `${operation}: must not add a sibling top-level merchantId`,
      );
    }
  });

  it("scopes every where mutation and prevents tenant reassignment", () => {
    for (const operation of TENANT_SCOPED_WHERE_MUTATIONS) {
      const deletes = operation === "delete" || operation === "deleteMany";
      const result = scopeTenantArgs(
        {
          where: { id: "row_1", merchantId: "mrc_hostile" },
          ...(deletes
            ? {}
            : {
                data: {
                  status: "closed",
                  merchantId: "mrc_hostile",
                },
              }),
        },
        operation,
        "mrc_1",
      );
      assert.deepEqual(
        result.where,
        { id: "row_1", merchantId: "mrc_1" },
        operation,
      );
      if (!deletes) {
        assert.deepEqual(
          result.data,
          { status: "closed", merchantId: "mrc_1" },
          operation,
        );
      }
    }
  });

  it("scopes every create operation with object or array data", () => {
    assert.deepEqual(
      injectMerchantIdIntoData(
        { id: "one", merchantId: "mrc_hostile" },
        "mrc_1",
      ),
      { id: "one", merchantId: "mrc_1" },
    );

    for (const operation of [
      "createMany",
      "createManyAndReturn",
    ] as const) {
      assert.deepEqual(
        scopeTenantArgs(
          {
            data: [
              { id: "one", merchantId: "mrc_hostile" },
              { id: "two" },
            ],
          },
          operation,
          "mrc_1",
        ).data,
        [
          { id: "one", merchantId: "mrc_1" },
          { id: "two", merchantId: "mrc_1" },
        ],
        operation,
      );
    }

    assert.deepEqual(
      scopeTenantArgs(
        {
          data: { id: "one", merchantId: "mrc_hostile" },
        },
        "create",
        "mrc_1",
      ).data,
      { id: "one", merchantId: "mrc_1" },
    );
  });

  it("scopes upsert where, create, and update branches", () => {
    const result = scopeTenantArgs(
      {
        where: { id: "row_1", merchantId: "mrc_hostile" },
        create: { id: "row_1", merchantId: "mrc_hostile" },
        update: { status: "open", merchantId: "mrc_hostile" },
      },
      "upsert",
      "mrc_1",
    );

    assert.deepEqual(result.where, { id: "row_1", merchantId: "mrc_1" });
    assert.deepEqual(result.create, { id: "row_1", merchantId: "mrc_1" });
    assert.deepEqual(result.update, { status: "open", merchantId: "mrc_1" });
  });

  it("fails closed for malformed write data", () => {
    assert.throws(
      () => scopeTenantArgs({ data: null }, "create", "mrc_1"),
      /tenant_scope_requires_object_data/,
    );
    assert.throws(
      () =>
        scopeTenantArgs(
          { data: [{ id: "ok" }, null] },
          "createMany",
          "mrc_1",
        ),
      /tenant_scope_requires_object_data/,
    );
    assert.throws(
      () => injectMerchantId({ where: {} }, " "),
      /tenant_scope_requires_merchant_id/,
    );
  });

  it("passes through without ALS context or for non-scoped models", () => {
    const args = { where: { status: "open" } };
    assert.equal(
      scopeTenantOperation("CheckoutSession", "findMany", args, null),
      args,
    );
    assert.equal(
      scopeTenantOperation(
        "Merchant",
        "findMany",
        args,
        { merchantId: "mrc_1", userId: "usr_1", role: "owner" },
      ),
      args,
    );
  });
});
