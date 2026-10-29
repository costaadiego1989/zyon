import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { PrismaImportJobRepository } from "./prisma-import-job.repository.js";

const runPrisma =
  process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "PrismaImportJobRepository create/getById/update round-trip + merchant boundary",
  {
    skip: runPrisma
      ? false
      : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests.",
  },
  async () => {
    const prisma = createPrismaClient();
    const repository = new PrismaImportJobRepository(prisma);
    const merchantId = `mrc_imp_${crypto.randomUUID().replace(/-/g, "")}`;
    const otherMerchantId = `mrc_imp_${crypto.randomUUID().replace(/-/g, "")}`;
    let createdId: string | null = null;

    try {
      const created = await repository.create({
        merchantId,
        fileName: "catalog.xlsx",
        fileRef: "s3://bucket/catalog.xlsx",
      });
      createdId = created.id;

      assert.ok(created.id);
      assert.equal(created.merchantId, merchantId);
      assert.equal(created.kind, "product_spreadsheet");
      assert.equal(created.status, "queued");
      assert.equal(created.fileName, "catalog.xlsx");
      assert.equal(created.fileRef, "s3://bucket/catalog.xlsx");
      assert.equal(created.totalRows, 0);
      assert.equal(created.successRows, 0);
      assert.equal(created.failedRows, 0);
      assert.deepEqual(created.columnMapping, {});
      assert.deepEqual(created.errors, []);
      assert.ok(created.createdAt instanceof Date);
      assert.equal(created.finishedAt, null);

      const fetched = await repository.getById(created.id, merchantId);
      assert.ok(fetched);
      assert.equal(fetched.id, created.id);
      assert.equal(fetched.status, "queued");

      // merchant boundary: wrong merchant returns null
      const cross = await repository.getById(created.id, otherMerchantId);
      assert.equal(cross, null);

      const finishedAt = new Date();
      const updated = await repository.update(created.id, merchantId, {
        status: "completed",
        totalRows: 10,
        successRows: 8,
        failedRows: 2,
        columnMapping: { sku: "SKU", price: "Preço" },
        errors: [
          { row: 3, sku: "ABC", reason: "invalid price" },
          { row: 7, reason: "missing sku" },
        ],
        finishedAt,
      });

      assert.equal(updated.status, "completed");
      assert.equal(updated.totalRows, 10);
      assert.equal(updated.successRows, 8);
      assert.equal(updated.failedRows, 2);
      assert.deepEqual(updated.columnMapping, { sku: "SKU", price: "Preço" });
      assert.deepEqual(updated.errors, [
        { row: 3, sku: "ABC", reason: "invalid price" },
        { row: 7, reason: "missing sku" },
      ]);
      assert.ok(updated.finishedAt instanceof Date);

      const reloaded = await repository.getById(created.id, merchantId);
      assert.ok(reloaded);
      assert.equal(reloaded.status, "completed");
      assert.deepEqual(reloaded.columnMapping, { sku: "SKU", price: "Preço" });
      assert.equal(reloaded.errors.length, 2);
      assert.equal(reloaded.errors[0].reason, "invalid price");
    } finally {
      if (createdId) {
        await prisma.importJob.deleteMany({ where: { merchantId } });
      }
      await prisma.$disconnect();
    }
  }
);
