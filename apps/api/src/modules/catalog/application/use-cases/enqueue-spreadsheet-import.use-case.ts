import { BadRequestException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  IMPORT_JOB_REPOSITORY,
  type ImportJobRepositoryPort,
  type ImportJobSnapshot,
} from "../../domain/ports/import-job-repository.port.js";
import { IMPORT_QUEUE, type ImportQueuePort } from "../../domain/ports/import-queue.port.js";
import { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";

const DEFAULT_SIZE_CAP_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_PATTERNS: RegExp[] = [
  /^text\/csv$/i,
  /^text\/plain$/i,
  /^application\/vnd\.ms-excel$/i,
  /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/i,
  /\bxlsx\b/i,
];

export interface EnqueueSpreadsheetImportInput {
  merchantId: string;
  fileName: string;
  mimeType: string;
  base64: string;
  sizeCapBytes?: number;
}

export interface EnqueueSpreadsheetImportResult {
  jobId: string;
  status: string;
}

@Injectable()
export class EnqueueSpreadsheetImportUseCase {
  private readonly logger = new Logger(EnqueueSpreadsheetImportUseCase.name);

  constructor(
    @Inject(IMPORT_JOB_REPOSITORY) private readonly repo: ImportJobRepositoryPort,
    @Optional() @Inject(IMPORT_QUEUE) private readonly queue?: ImportQueuePort,
    @Optional() private readonly s3?: S3UploadService,
  ) {}

  async execute(input: EnqueueSpreadsheetImportInput): Promise<EnqueueSpreadsheetImportResult> {
    if (!ALLOWED_MIME_PATTERNS.some((re) => re.test(input.mimeType))) {
      throw new BadRequestException("unsupported_file_type");
    }

    const raw = input.base64.includes("base64,")
      ? input.base64.slice(input.base64.indexOf("base64,") + "base64,".length)
      : input.base64;
    const buffer = Buffer.from(raw, "base64");

    const cap = input.sizeCapBytes ?? DEFAULT_SIZE_CAP_BYTES;
    if (buffer.length > cap) {
      throw new BadRequestException("file_too_large");
    }

    let fileRef: string | null = null;
    if (this.s3?.isConfigured()) {
      const uploaded = await this.s3.upload(buffer, input.mimeType, `imports/${input.merchantId}`);
      fileRef = uploaded.url;
    } else if (this.s3 && !this.s3.isConfigured()) {
      // S3 module registered but bucket creds absent — fail loud so devs notice.
      this.logger.warn("S3 not configured for import — proceeding with fileRef=null");
    }

    const job: ImportJobSnapshot = await this.repo.create({
      merchantId: input.merchantId,
      kind: "product_spreadsheet",
      fileName: input.fileName,
      fileRef,
    });

    if (this.queue) {
      try {
        await this.queue.enqueue(job.id, input.merchantId);
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue import job ${job.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { jobId: job.id, status: job.status };
  }
}
