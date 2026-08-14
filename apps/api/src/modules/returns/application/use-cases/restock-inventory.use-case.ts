import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity } from "../../domain/entities/return.entity.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

@Injectable()
export class RestockInventoryUseCase {
  private readonly logger = new Logger(RestockInventoryUseCase.name);

  constructor(
    @Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(merchantId: string, returnId: string): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    if (!ret.canRestock) {
      throw new BadRequestException("invalid_status_for_restock");
    }

    // Only restock items with inspection pass (good condition)
    const inspectionCondition = ret.inspection?.itemCondition;
    if (inspectionCondition === "UNUSABLE") {
      throw new BadRequestException("cannot_restock_unusable_items");
    }

    try {
      for (const item of ret.items) {
        await this.prisma.productStock.updateMany({
          where: { variantId: item.variantId },
          data: { quantity: { increment: item.quantity } },
        });
      }
    } catch (err) {
      this.logger.error(`Restock failed for return ${returnId}: ${(err as Error).message}`);
      // Restock failure: log audit event, manual intervention needed
      throw err;
    }

    return ret;
  }
}
