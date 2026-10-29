export const IMPORT_JOB_REPOSITORY = Symbol("ImportJobRepositoryPort");

export interface ImportRowError {
  row: number;
  sku?: string;
  reason: string;
}

export type ImportJobStatus = "queued" | "processing" | "completed" | "failed";

export interface ImportJobSnapshot {
  id: string;
  merchantId: string;
  kind?: string;
  status: ImportJobStatus;
  fileName: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  columnMapping: Record<string, string>;
  errors: ImportRowError[];
  fileRef?: string | null;
  createdAt: Date;
  finishedAt?: Date | null;
}

export interface ImportJobRepositoryPort {
  create(input: {
    merchantId: string;
    kind?: string;
    fileName: string;
    fileRef?: string | null;
  }): Promise<ImportJobSnapshot>;

  update(
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
  ): Promise<ImportJobSnapshot>;

  getById(id: string, merchantId: string): Promise<ImportJobSnapshot | null>;
}
