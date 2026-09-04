import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";

@Injectable()
export class GetTrackingTimelineUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(input: { merchantId: string; trackingCode: string }) {
    const shipment = await this.repo.getShipmentByTrackingCode(input.merchantId, input.trackingCode);
    if (!shipment) throw new NotFoundException("shipment_not_found");
    return {
      shipment,
      events: await this.repo.listTrackingEvents(input.merchantId, input.trackingCode)
    };
  }
}
