import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ImportJobEntity } from "./import-job.entity.js";

describe("ImportJobEntity", () => {
  describe("create() factory", () => {
    it("should create a queued import job with default values", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
        fileRef: "s3://bucket/products.xlsx",
      });

      assert.strictEqual(entity.status, "queued");
      assert.strictEqual(entity.merchantId, "mrc_1");
      assert.strictEqual(entity.fileName, "products.xlsx");
      assert.strictEqual(entity.kind, "upsert_products");
      assert.strictEqual(entity.totalRows, 0);
      assert.strictEqual(entity.successRows, 0);
      assert.strictEqual(entity.failedRows, 0);
      assert.deepEqual(entity.errors, []);
      assert.deepEqual(entity.columnMapping, {});
      assert.ok(entity.id);
      assert.ok(entity.createdAt);
    });

    it("should allow optional fileRef", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      assert.strictEqual(entity.fileRef, null);
    });
  });

  describe("markProcessing()", () => {
    it("should transition from queued to processing", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      const updated = entity.markProcessing();
      assert.strictEqual(updated.status, "processing");
    });

    it("should throw import_job_invalid_transition when called from completed", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      const processing = entity.markProcessing();
      const completed = processing.markCompleted({
        totalRows: 100,
        successRows: 100,
        failedRows: 0,
        errors: [],
        columnMapping: { A: "name", B: "sku" },
      });

      assert.throws(
        () => completed.markProcessing(),
        {
          name: "Error",
          message: /import_job_invalid_transition/,
        }
      );
    });

    it("should throw import_job_invalid_transition when called from failed", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      const processing = entity.markProcessing();
      const failed = processing.markFailed("Something went wrong");

      assert.throws(
        () => failed.markProcessing(),
        {
          name: "Error",
          message: /import_job_invalid_transition/,
        }
      );
    });
  });

  describe("markCompleted()", () => {
    it("should transition from processing to completed", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      const processing = entity.markProcessing();
      const completed = processing.markCompleted({
        totalRows: 100,
        successRows: 95,
        failedRows: 5,
        errors: [{ row: 10, sku: "SKU123", reason: "invalid price" }],
        columnMapping: { A: "name", B: "sku", C: "price" },
      });

      assert.strictEqual(completed.status, "completed");
      assert.strictEqual(completed.totalRows, 100);
      assert.strictEqual(completed.successRows, 95);
      assert.strictEqual(completed.failedRows, 5);
      assert.deepEqual(completed.columnMapping, { A: "name", B: "sku", C: "price" });
      assert.ok(completed.finishedAt);
    });

    it("should throw import_job_counts_mismatch when successRows + failedRows !== totalRows", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      const processing = entity.markProcessing();

      assert.throws(
        () =>
          processing.markCompleted({
            totalRows: 100,
            successRows: 95,
            failedRows: 3, // 95 + 3 = 98, not 100
            errors: [],
            columnMapping: {},
          }),
        {
          name: "Error",
          message: /import_job_counts_mismatch/,
        }
      );
    });

    it("should throw import_job_invalid_transition when called from queued", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      assert.throws(
        () =>
          entity.markCompleted({
            totalRows: 100,
            successRows: 100,
            failedRows: 0,
            errors: [],
            columnMapping: {},
          }),
        {
          name: "Error",
          message: /import_job_invalid_transition/,
        }
      );
    });

    it("should throw import_job_invalid_transition when called from completed", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      const processing = entity.markProcessing();
      const completed = processing.markCompleted({
        totalRows: 100,
        successRows: 100,
        failedRows: 0,
        errors: [],
        columnMapping: {},
      });

      assert.throws(
        () =>
          completed.markCompleted({
            totalRows: 100,
            successRows: 100,
            failedRows: 0,
            errors: [],
            columnMapping: {},
          }),
        {
          name: "Error",
          message: /import_job_invalid_transition/,
        }
      );
    });
  });

  describe("markFailed()", () => {
    it("should transition from queued to failed with reason", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      const failed = entity.markFailed("File corrupted");

      assert.strictEqual(failed.status, "failed");
      assert.ok(failed.finishedAt);
    });

    it("should transition from processing to failed with reason", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      const processing = entity.markProcessing();
      const failed = processing.markFailed("Timeout during processing");

      assert.strictEqual(failed.status, "failed");
      assert.ok(failed.finishedAt);
    });

    it("should throw import_job_invalid_transition when called from completed", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
      });

      const processing = entity.markProcessing();
      const completed = processing.markCompleted({
        totalRows: 100,
        successRows: 100,
        failedRows: 0,
        errors: [],
        columnMapping: {},
      });

      assert.throws(
        () => completed.markFailed("Too late to fail"),
        {
          name: "Error",
          message: /import_job_invalid_transition/,
        }
      );
    });
  });

  describe("snapshot()", () => {
    it("should return plain props", () => {
      const entity = ImportJobEntity.create({
        merchantId: "mrc_1",
        kind: "upsert_products",
        fileName: "products.xlsx",
        fileRef: "s3://bucket/products.xlsx",
      });

      const snap = entity.snapshot();

      assert.ok(snap.id);
      assert.strictEqual(snap.merchantId, "mrc_1");
      assert.strictEqual(snap.status, "queued");
      assert.strictEqual(snap.fileName, "products.xlsx");
      assert.strictEqual(snap.fileRef, "s3://bucket/products.xlsx");
      assert.ok(snap.createdAt);
    });
  });
});
