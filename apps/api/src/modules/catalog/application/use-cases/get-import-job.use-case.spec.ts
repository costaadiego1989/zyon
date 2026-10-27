import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { GetImportJobUseCase } from "./get-import-job.use-case.js";
import type {
  ImportJobRepositoryPort,
  ImportJobSnapshot,
} from "../../domain/ports/import-job-repository.port.js";

function makeRepoDouble(overrides: Partial<ImportJobRepositoryPort> = {}): ImportJobRepositoryPort {
  return {
    create: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
    getById: async () => null,
    ...overrides,
  };
}

const snapshot: ImportJobSnapshot = {
  id: "job_test_1",
  merchantId: "mrc_1",
  kind: "product_spreadsheet",
  status: "queued",
  fileName: "products.csv",
  totalRows: 0,
  successRows: 0,
  failedRows: 0,
  columnMapping: {},
  errors: [],
  fileRef: null,
  createdAt: new Date("2026-09-02T00:00:00Z"),
  finishedAt: null,
};

describe("GetImportJobUseCase", () => {
  it("returns snapshot when repo finds it (merchant-scoped)", async () => {
    const repo = makeRepoDouble({
      getById: async (id, merchantId) => {
        assert.equal(id, "job_test_1");
        assert.equal(merchantId, "mrc_1");
        return snapshot;
      },
    });
    const useCase = new GetImportJobUseCase(repo);

    const result = await useCase.execute({ jobId: "job_test_1", merchantId: "mrc_1" });
    assert.equal(result.id, "job_test_1");
    assert.equal(result.status, "queued");
  });

  it("throws NotFoundException when repo returns null (cross-merchant or missing)", async () => {
    const repo = makeRepoDouble({
      getById: async () => null,
    });
    const useCase = new GetImportJobUseCase(repo);

    await assert.rejects(
      () => useCase.execute({ jobId: "job_other", merchantId: "mrc_other" }),
      (err: unknown) => err instanceof NotFoundException && err.message === "import_job_not_found",
    );
  });
});
