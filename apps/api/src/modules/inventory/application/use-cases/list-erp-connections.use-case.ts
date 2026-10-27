import { Injectable, Inject } from "@nestjs/common";
import { ERP_REPOSITORY, type ErpRepositoryPort } from "../../domain/ports/erp-repository.port.js";
import { erpCooldownUntil, isErpAuthError } from "../../infrastructure/adapters/erp-provider-error.js";

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
      status: c.status === "connected" && isErpAuthError(c.lastErrorCode) ? "error" : c.status,
      requiresReconnect: isErpAuthError(c.lastErrorCode),
      retryAfterAt: erpCooldownUntil(c.config)?.toISOString() ?? null,
      lastSyncAt: c.lastSyncAt?.toISOString() || null,
      lastErrorCode: c.lastErrorCode,
      directionMode: c.directionMode,
      createdAt: c.createdAt?.toISOString() || new Date().toISOString(),
    }));
  }
}
