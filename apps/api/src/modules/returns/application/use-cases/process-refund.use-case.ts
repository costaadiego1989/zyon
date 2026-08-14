import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity } from "../../domain/entities/return.entity.js";

@Injectable()
export class ProcessRefundUseCase {
  private readonly logger = new Logger(ProcessRefundUseCase.name);

  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort) {}

  async execute(merchantId: string, returnId: string): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    if (!ret.canRefund) {
      throw new BadRequestException("invalid_status_for_refund");
    }

    // MVP stub: calculate refund from items (would normally query original order)
    // For now, we use a placeholder amount
    const amountInCents = ret.items.reduce((sum, item) => sum + item.quantity * 1000, 0);

    await this.returnRepo.updateStatus(returnId, "REFUND_PROCESSING");

    try {
      // MVP stub: call payment provider for refund
      // In production: await this.paymentService.refund(...)
      await this.returnRepo.saveRefund({
        returnId,
        amountInCents,
        status: "COMPLETED",
      });
      await this.returnRepo.updateRefundStatus(returnId, "COMPLETED", new Date());
      await this.returnRepo.updateStatus(returnId, "REFUND_COMPLETED");
    } catch (err) {
      this.logger.error(`Refund failed for return ${returnId}: ${(err as Error).message}`);
      // Status stays REFUND_PROCESSING — retry via BullMQ
      throw err;
    }

    return (await this.returnRepo.findById(merchantId, returnId))!;
  }
}
