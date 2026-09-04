import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import {
  SHIPMENT_REPOSITORY,
  type ShipmentRepository,
  type ListShipmentsResult,
} from "../../domain/ports/shipment-repository.port.js";

export type ListShipmentsInput = {
  merchantId: string;
  limit: number;
  cursor?: string;
  orderId?: string;
  status?: string;
};

@Injectable()
export class ListShipmentsUseCase {
  constructor(
    @Inject(SHIPMENT_REPOSITORY) private readonly repo: ShipmentRepository,
  ) {}

  async execute(input: ListShipmentsInput): Promise<ListShipmentsResult> {
    if (!input.merchantId?.trim()) {
      throw new BadRequestException("merchant_id_required");
    }

    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

    return this.repo.listByMerchant({
      merchantId: input.merchantId,
      limit,
      cursor: input.cursor,
      orderId: input.orderId,
      status: input.status,
    });
  }
}
