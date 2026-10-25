import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  ImportJobRepositoryPort,
  ImportJobSnapshot,
  ImportJobStatus,
  ImportRowError,
} from "../../domain/ports/import-job-repository.port.js";

export class PrismaImportJobRepository implements ImportJobRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: {
    merchantId: string;
    kind?: string;
    fileName: string;
    fileRef?: string | null;
  }): Promise<ImportJobSnapshot> {
    const row = await this.prisma.importJob.create({
      data: {
        merchantId: input.merchantId,
        kind: input.kind ?? "product_spreadsheet",
        fileName: input.fileName,
        fileRef: input.fileRef ?? null,
        status: "queued",
      },
    });
    return this.mapToDomain(row);
  }

  async update(
    id: string,
    merchantId: string,
    patch: Partial<{
      status: ImportJobStatus;
      totalRows: number;
      successRows: number;
      failedRows: number;
      columnMapping: Record<string, string>;
      errors: ImportRowError[];
      finishedAt: Date | null;
    }>
  ): Promise<ImportJobSnapshot> {
    const data: Prisma.ImportJobUpdateInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.totalRows !== undefined) data.totalRows = patch.totalRows;
    if (patch.successRows !== undefined) data.successRows = patch.successRows;
    if (patch.failedRows !== undefined) data.failedRows = patch.failedRows;
    if (patch.columnMapping !== undefined) {
      data.columnMapping = patch.columnMapping as Prisma.InputJsonValue;
    }
    if (patch.errors !== undefined) {
      data.errors = patch.errors as unknown as Prisma.InputJsonValue;
    }
    if (patch.finishedAt !== undefined) data.finishedAt = patch.finishedAt;

    const row = await this.prisma.importJob.update({
      where: { id, merchantId },
      data,
    });
    return this.mapToDomain(row);
  }

  async getById(
    id: string,
    merchantId: string
  ): Promise<ImportJobSnapshot | null> {
    const row = await this.prisma.importJob.findUnique({
      where: { id, merchantId },
    });
    return row ? this.mapToDomain(row) : null;
  }

  private mapToDomain(row: any): ImportJobSnapshot {
    return {
      id: row.id,
      merchantId: row.merchantId,
      kind: row.kind,
      status: row.status as ImportJobStatus,
      fileName: row.fileName,
      totalRows: row.totalRows,
      successRows: row.successRows,
      failedRows: row.failedRows,
      columnMapping: (row.columnMapping ?? {}) as Record<string, string>,
      errors: (row.errors ?? []) as ImportRowError[],
      fileRef: row.fileRef ?? null,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt ?? null,
    };
  }
}
