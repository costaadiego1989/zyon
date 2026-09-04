import { Injectable, Inject } from "@nestjs/common";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort } from "../../domain/ports/crm-connection-repository.port.js";

@Injectable()
export class DisconnectCrmUseCase {
  constructor(
    @Inject(CRM_CONNECTION_REPOSITORY) private readonly repo: CrmConnectionRepositoryPort
  ) {}

  async execute(merchantId: string, id: string) {
    await this.repo.delete(merchantId, id);
    return { success: true };
  }
}
