import { Injectable, Inject } from "@nestjs/common";
import { ERP_REPOSITORY, type ErpRepositoryPort } from "../../domain/ports/erp-repository.port.js";

@Injectable()
export class DisconnectErpUseCase {
  constructor(
    @Inject(ERP_REPOSITORY) private readonly repo: ErpRepositoryPort
  ) {}

  async execute(merchantId: string, connectionId: string): Promise<void> {
    await this.repo.delete(merchantId, connectionId);
  }
}
