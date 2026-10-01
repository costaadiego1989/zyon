import { Injectable } from "@nestjs/common";
import { isMarketplaceProvider } from "../../infrastructure/adapters/marketplace-adapter.factory.js";
import { ErpSyncService } from "../services/erp-sync.service.js";

@Injectable()
export class TriggerMarketplaceSyncUseCase {
  constructor(private readonly sync: ErpSyncService) {}

  async execute(input: { merchantId: string; provider: string; connectionId: string }) {
    if (!isMarketplaceProvider(input.provider)) throw new Error("erp_provider_not_supported");
    return this.sync.enqueueFull(input.merchantId, input.connectionId, "initial");
  }
}
