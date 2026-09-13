import { Injectable } from "@nestjs/common";
import { ErpSyncService } from "../services/erp-sync.service.js";

@Injectable()
export class TriggerErpSyncUseCase {
  constructor(private readonly sync: ErpSyncService) {}

  async execute(merchantId: string, connectionId: string) {
    const job = await this.sync.enqueueFull(merchantId, connectionId, "manual");
    return { jobId: job.id, connectionId, status: job.status, message: "Sincronização agendada" };
  }
}
