import { Injectable, Inject, BadRequestException, Logger } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort, CreateReturnInput } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity, type ReturnReason } from "../../domain/entities/return.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

const VALID_REASONS: ReturnReason[] = ["DEFECTIVE", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND", "DAMAGED_IN_TRANSIT", "OTHER"];

@Injectable()
export class RequestReturnUseCase {
  private readonly logger = new Logger(RequestReturnUseCase.name);

  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort) {}

  async execute(input: {
    merchantId: string;
    orderId?: string;
    buyerId: string;
    reason: string;
    notes?: string;
    imageUrls?: string[];
    items: Array<{ variantId: string; quantity: number; reason?: string }>;
  }): Promise<ReturnEntity> {
    if (!VALID_REASONS.includes(input.reason as ReturnReason)) {
      throw new BadRequestException("invalid_return_reason");
    }
    if (!input.items?.length) {
      throw new BadRequestException("at_least_one_item_required");
    }
    for (const item of input.items) {
      if (item.quantity <= 0) throw new BadRequestException("quantity_must_be_positive");
    }

    const orderId = input.orderId?.trim() || `manual_${Date.now()}`;

    if (input.orderId?.trim()) {
      const existing = await this.returnRepo.findByOrderId(input.merchantId, orderId);
      const activeReturn = existing.find((r) => r.status !== "CANCELLED" && r.status !== "REJECTED");
      if (activeReturn) {
        throw new BadRequestException("active_return_already_exists_for_order");
      }
    }

    const created = await this.returnRepo.create({
      merchantId: input.merchantId,
      orderId,
      buyerId: input.buyerId,
      reason: input.reason,
      notes: input.notes,
      imageUrls: input.imageUrls,
      items: input.items,
    });

    return created;
  }
}
