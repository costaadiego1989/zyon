import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";

@Injectable()
export class CancelShipmentUseCase {
  constructor(
    @Inject(SHIPMENT_REPOSITORY) private readonly repo: ShipmentRepository
  ) {}

  async execute(input: { shipment_id: string; merchant_id: string }) {
    const shipment = await this.repo.findById(input.shipment_id, input.merchant_id);
    if (!shipment) throw new NotFoundException("shipment_not_found");
    const cancelled = shipment.transition("cancelled");
    await this.repo.save(cancelled);
    return cancelled.snapshot();
  }
}
