import { Inject, Injectable } from "@nestjs/common";
import { ErpSyncService } from "../services/erp-sync.service.js";
import { ERP_REPOSITORY, type ErpRepositoryPort } from "../../domain/ports/erp-repository.port.js";
import { TriggerMarketplaceSyncUseCase } from "./trigger-marketplace-sync.use-case.js";

@Injectable()
export class TriggerErpSyncUseCase {
  constructor(
    private readonly sync: ErpSyncService,
    @Inject(ERP_REPOSITORY) private readonly erpRepo: ErpRepositoryPort,
    private readonly marketplaceSync: TriggerMarketplaceSyncUseCase,
  ) {}

  async execute(merchantId: string, connectionId: string) {
    const tiktok = await this.erpRepo.findByProvider(merchantId, "tiktokshop");
    if (tiktok?.id === connectionId) {
      if (tiktok.status !== "connected" || !tiktok.accessTokenCipher) throw new Error("tiktokshop_connection_not_connected");
      const result = await this.marketplaceSync.execute({
        merchantId, connectionId, provider: "tiktokshop", accessToken: "",
      });
      if (!result.synced) throw new Error("tiktokshop_sync_failed");
      return { connectionId, status: "completed", productsImported: result.productsImported, message: "Sincronização concluída" };
    }
    const job = await this.sync.enqueueFull(merchantId, connectionId, "manual");
    return { jobId: job.id, connectionId, status: job.status, message: "Sincronização agendada" };
  }
}
