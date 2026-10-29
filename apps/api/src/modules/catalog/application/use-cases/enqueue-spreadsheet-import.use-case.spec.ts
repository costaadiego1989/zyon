import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { EnqueueSpreadsheetImportUseCase } from "./enqueue-spreadsheet-import.use-case.js";
import type {
  ImportJobRepositoryPort,
  ImportJobSnapshot,
} from "../../domain/ports/import-job-repository.port.js";
import type { ImportQueuePort } from "../../domain/ports/import-queue.port.js";
import type { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";

function makeRepoDouble(overrides: Partial<ImportJobRepositoryPort> = {}): ImportJobRepositoryPort {
  return {
    create: async (input): Promise<ImportJobSnapshot> => ({
      id: "job_test_1",
      merchantId: input.merchantId,
      kind: input.kind ?? "product_spreadsheet",
      status: "queued",
      fileName: input.fileName,
      totalRows: 0,
      successRows: 0,
      failedRows: 0,
      columnMapping: {},
      errors: [],
      fileRef: input.fileRef ?? null,
      createdAt: new Date(),
      finishedAt: null,
    }),
    update: async () => {
      throw new Error("not used");
    },
    getById: async () => null,
    ...overrides,
  };
}

function makeQueueDouble(capture: { called: boolean; jobId?: string; merchantId?: string }): ImportQueuePort {
  return {
    enqueue: async (jobId, merchantId) => {
      capture.called = true;
      capture.jobId = jobId;
      capture.merchantId = merchantId;
    },
  };
}

function makeS3Double(overrides: Partial<S3UploadService> = {}): S3UploadService {
  return {
    upload: async () => {
      throw new Error("not used");
    },
    uploadBase64: async () => {
      throw new Error("not used");
    },
    delete: async () => {
      /* noop */
    },
    isConfigured: () => false,
    ...overrides,
  } as unknown as S3UploadService;
}

const baseInput = {
  merchantId: "mrc_1",
  fileName: "products.csv",
  mimeType: "text/csv",
  base64: Buffer.from("sku,name\n1,foo\n").toString("base64"),
};

describe("EnqueueSpreadsheetImportUseCase", () => {
  it("creates a queued job and enqueues when CSV is valid", async () => {
    const capture = { called: false, jobId: undefined as string | undefined, merchantId: undefined as string | undefined };
    const repo = makeRepoDouble();
    const queue = makeQueueDouble(capture);
    const s3 = makeS3Double();
    const useCase = new EnqueueSpreadsheetImportUseCase(repo, queue, s3);

    const result = await useCase.execute(baseInput);

    assert.equal(result.jobId, "job_test_1");
    assert.equal(result.status, "queued");
    assert.equal(capture.called, true, "queue.enqueue should be invoked");
    assert.equal(capture.jobId, "job_test_1");
    assert.equal(capture.merchantId, "mrc_1");
  });

  it("accepts xlsx mime type", async () => {
    const capture = { called: false, jobId: undefined as string | undefined, merchantId: undefined as string | undefined };
    const repo = makeRepoDouble();
    const queue = makeQueueDouble(capture);
    const s3 = makeS3Double();
    const useCase = new EnqueueSpreadsheetImportUseCase(repo, queue, s3);

    const result = await useCase.execute({
      ...baseInput,
      fileName: "products.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    assert.equal(result.status, "queued");
    assert.equal(capture.called, true);
  });

  it("strips data: URI prefix from base64 payload", async () => {
    const capture = { called: false, jobId: undefined as string | undefined, merchantId: undefined as string | undefined };
    const repo = makeRepoDouble();
    const queue = makeQueueDouble(capture);
    const s3 = makeS3Double();
    const useCase = new EnqueueSpreadsheetImportUseCase(repo, queue, s3);

    const raw = Buffer.from("sku,name\n1,foo\n").toString("base64");
    const dataUri = `data:text/csv;base64,${raw}`;
    const result = await useCase.execute({ ...baseInput, base64: dataUri });

    assert.equal(result.status, "queued");
    assert.equal(capture.called, true);
  });

  it("rejects unsupported mime types with BadRequestException", async () => {
    const repo = makeRepoDouble();
    const queue = makeQueueDouble({ called: false });
    const s3 = makeS3Double();
    const useCase = new EnqueueSpreadsheetImportUseCase(repo, queue, s3);

    await assert.rejects(
      () => useCase.execute({ ...baseInput, mimeType: "application/pdf" }),
      (err: unknown) => err instanceof BadRequestException && err.message === "unsupported_file_type",
    );
  });

  it("rejects payloads exceeding sizeCapBytes with BadRequestException", async () => {
    const repo = makeRepoDouble();
    const queue = makeQueueDouble({ called: false });
    const s3 = makeS3Double();
    const useCase = new EnqueueSpreadsheetImportUseCase(repo, queue, s3);
    const big = Buffer.alloc(2_000).toString("base64");

    await assert.rejects(
      () => useCase.execute({ ...baseInput, base64: big, sizeCapBytes: 512 }),
      (err: unknown) => err instanceof BadRequestException && err.message === "file_too_large",
    );
  });

  it("does not call repo.create when validation fails", async () => {
    let createCalled = false;
    const repo = makeRepoDouble({
      create: async () => {
        createCalled = true;
        throw new Error("should not be called");
      },
    });
    const queue = makeQueueDouble({ called: false });
    const s3 = makeS3Double();
    const useCase = new EnqueueSpreadsheetImportUseCase(repo, queue, s3);

    await assert.rejects(async () => useCase.execute({ ...baseInput, mimeType: "image/png" }));
    assert.equal(createCalled, false);
  });

  it("works without a queue injected (dev path) and still creates the job", async () => {
    const repo = makeRepoDouble();
    const s3 = makeS3Double();
    const useCase = new EnqueueSpreadsheetImportUseCase(repo, undefined, s3);

    const result = await useCase.execute(baseInput);
    assert.equal(result.status, "queued");
  });

  it("uses null fileRef and skips S3 when S3 is not configured", async () => {
    let capturedFileRef: string | null | undefined;
    const repo = makeRepoDouble({
      create: async (input) => {
        capturedFileRef = input.fileRef ?? null;
        return {
          id: "job_x",
          merchantId: input.merchantId,
          kind: input.kind ?? "product_spreadsheet",
          status: "queued",
          fileName: input.fileName,
          totalRows: 0,
          successRows: 0,
          failedRows: 0,
          columnMapping: {},
          errors: [],
          fileRef: input.fileRef ?? null,
          createdAt: new Date(),
          finishedAt: null,
        };
      },
    });
    const queue = makeQueueDouble({ called: false });
    const s3 = makeS3Double({ isConfigured: () => false });
    const useCase = new EnqueueSpreadsheetImportUseCase(repo, queue, s3);

    await useCase.execute(baseInput);
    assert.equal(capturedFileRef, null);
  });

  it("uploads to S3 and stores fileRef when configured", async () => {
    let uploadCalls = 0;
    let uploadedFolder: string | undefined;
    let uploadedMime: string | undefined;
    const repo = makeRepoDouble();
    const queue = makeQueueDouble({ called: false });
    const s3 = makeS3Double({
      isConfigured: () => true,
      upload: async (buffer, contentType, folder) => {
        uploadCalls += 1;
        uploadedMime = contentType;
        uploadedFolder = folder;
        return { url: `https://bucket/${folder}/x.csv`, key: `${folder}/x.csv`, bucket: "bucket" };
      },
    });
    const useCase = new EnqueueSpreadsheetImportUseCase(repo, queue, s3);

    await useCase.execute(baseInput);
    assert.equal(uploadCalls, 1);
    assert.equal(uploadedMime, "text/csv");
    assert.equal(uploadedFolder, "imports/mrc_1");
  });
});
