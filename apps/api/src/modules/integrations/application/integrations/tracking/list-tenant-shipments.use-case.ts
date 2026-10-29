import { Inject, Injectable } from "@nestjs/common";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";

@Injectable()
export class ListTenantShipmentsUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string, limit?: number) {
    return this.repo.listShipments(merchantId, limit);
  }
}
