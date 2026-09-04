import { Injectable, Inject } from "@nestjs/common";
import { ERP_REPOSITORY, type ErpRepositoryPort } from "../../domain/ports/erp-repository.port.js";

@Injectable()
export class ListErpConnectionsUseCase {
  constructor(
    @Inject(ERP_REPOSITORY) private readonly repo: ErpRepositoryPort
  ) {}

  async execute(merchantId: string) {
    const connections = await this.repo.list(merchantId);
    return connections.map((c) => ({
      id: c.id,
      merchantId: c.merchantId,
      provider: c.provider,
      status: c.status,
      lastSyncAt: c.lastSyncAt?.toISOString() || null,
      directionMode: "push", // default push mode
      createdAt: c.createdAt?.toISOString() || new Date().toISOString(),
    }));
  }
}
