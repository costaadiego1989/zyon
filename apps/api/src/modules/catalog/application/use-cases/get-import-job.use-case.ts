import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  IMPORT_JOB_REPOSITORY,
  type ImportJobRepositoryPort,
  type ImportJobSnapshot,
} from "../../domain/ports/import-job-repository.port.js";

export interface GetImportJobInput {
  jobId: string;
  merchantId: string;
}

@Injectable()
export class GetImportJobUseCase {
  constructor(
    @Inject(IMPORT_JOB_REPOSITORY) private readonly repo: ImportJobRepositoryPort,
  ) {}

  async execute(input: GetImportJobInput): Promise<ImportJobSnapshot> {
    const snapshot = await this.repo.getById(input.jobId, input.merchantId);
    if (!snapshot) {
      throw new NotFoundException("import_job_not_found");
    }
    return snapshot;
  }
}
