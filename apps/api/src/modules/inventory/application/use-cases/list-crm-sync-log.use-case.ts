import { Injectable, Inject } from "@nestjs/common";
import { CRM_SYNC_LOG_REPOSITORY, type CrmSyncLogRepositoryPort } from "../../domain/ports/crm-sync-log-repository.port.js";

@Injectable()
export class ListCrmSyncLogUseCase {
  constructor(
    @Inject(CRM_SYNC_LOG_REPOSITORY) private readonly repo: CrmSyncLogRepositoryPort,
  ) {}

  async execute(merchantId: string, limit = 50) {
    const rows = await this.repo.list(merchantId, limit);
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      email: r.email,
      stage: r.stage,
      status: r.status,
      error_code: r.errorCode,
      created_at: r.createdAt.toISOString(),
    }));
  }
}
