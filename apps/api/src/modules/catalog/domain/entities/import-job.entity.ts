export type ImportJobStatus = "queued" | "processing" | "completed" | "failed";

export interface ImportRowError {
  row: number;
  sku?: string;
  reason: string;
}

export interface ImportJobProps {
  id?: string;
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

export class ImportJobEntity {
  readonly id: string;
  readonly merchantId: string;
  readonly kind?: string;
  readonly status: ImportJobStatus;
  readonly fileName: string;
  readonly totalRows: number;
  readonly successRows: number;
  readonly failedRows: number;
  readonly columnMapping: Record<string, string>;
  readonly errors: ImportRowError[];
  readonly fileRef?: string | null;
  readonly createdAt: Date;
  readonly finishedAt?: Date | null;

  private constructor(props: ImportJobProps & { id: string; createdAt: Date }) {
    this.id = props.id;
    this.merchantId = props.merchantId;
    this.kind = props.kind;
    this.status = props.status;
    this.fileName = props.fileName;
    this.totalRows = props.totalRows;
    this.successRows = props.successRows;
    this.failedRows = props.failedRows;
    this.columnMapping = props.columnMapping;
    this.errors = props.errors;
    this.fileRef = props.fileRef ?? null;
    this.createdAt = props.createdAt;
    this.finishedAt = props.finishedAt ?? null;
  }

  static create(props: {
    merchantId: string;
    kind?: string;
    fileName: string;
    fileRef?: string | null;
  }): ImportJobEntity {
    const id = this.generateId();
    const now = new Date();

    return new ImportJobEntity({
      id,
      merchantId: props.merchantId,
      kind: props.kind,
      status: "queued",
      fileName: props.fileName,
      fileRef: props.fileRef ?? null,
      totalRows: 0,
      successRows: 0,
      failedRows: 0,
      columnMapping: {},
      errors: [],
      createdAt: now,
    });
  }

  markProcessing(): ImportJobEntity {
    if (this.status !== "queued") {
      throw new Error("import_job_invalid_transition");
    }

    return new ImportJobEntity({
      ...this.snapshot(),
      status: "processing",
    });
  }

  markCompleted(input: {
    totalRows: number;
    successRows: number;
    failedRows: number;
    errors: ImportRowError[];
    columnMapping: Record<string, string>;
  }): ImportJobEntity {
    if (this.status !== "processing") {
      throw new Error("import_job_invalid_transition");
    }

    if (input.successRows + input.failedRows !== input.totalRows) {
      throw new Error("import_job_counts_mismatch");
    }

    const now = new Date();

    return new ImportJobEntity({
      ...this.snapshot(),
      status: "completed",
      totalRows: input.totalRows,
      successRows: input.successRows,
      failedRows: input.failedRows,
      errors: input.errors,
      columnMapping: input.columnMapping,
      finishedAt: now,
    });
  }

  markFailed(reason: string): ImportJobEntity {
    if (this.status !== "queued" && this.status !== "processing") {
      throw new Error("import_job_invalid_transition");
    }

    const now = new Date();

    return new ImportJobEntity({
      ...this.snapshot(),
      status: "failed",
      finishedAt: now,
    });
  }

  snapshot(): ImportJobProps & { id: string; createdAt: Date } {
    return {
      id: this.id,
      merchantId: this.merchantId,
      kind: this.kind,
      status: this.status,
      fileName: this.fileName,
      totalRows: this.totalRows,
      successRows: this.successRows,
      failedRows: this.failedRows,
      columnMapping: this.columnMapping,
      errors: this.errors,
      fileRef: this.fileRef,
      createdAt: this.createdAt,
      finishedAt: this.finishedAt,
    };
  }

  private static generateId(): string {
    return `imp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
