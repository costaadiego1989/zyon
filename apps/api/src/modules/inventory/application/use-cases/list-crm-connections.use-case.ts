import { Injectable, Inject } from "@nestjs/common";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort } from "../../domain/ports/crm-connection-repository.port.js";
import { publicCrmConnection } from "../../domain/ports/crm-connection-repository.port.js";

@Injectable()
export class ListCrmConnectionsUseCase {
  constructor(
    @Inject(CRM_CONNECTION_REPOSITORY) private readonly repo: CrmConnectionRepositoryPort
  ) {}

  async execute(merchantId: string) {
    return (await this.repo.list(merchantId)).map(publicCrmConnection);
  }
}
