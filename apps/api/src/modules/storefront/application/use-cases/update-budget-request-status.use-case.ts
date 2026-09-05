import { Inject, Injectable, BadRequestException, NotFoundException , Logger} from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export type BudgetRequestStatus = "approved" | "rejected" | "responded";

@Injectable()
export class UpdateBudgetRequestStatusUseCase {
  private readonly logger = new Logger(UpdateBudgetRequestStatusUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, id: string, status: BudgetRequestStatus): Promise<{ id: string; status: string }> {
    if (!merchantId?.trim()) throw new BadRequestException("merchant_id_required");
    if (!["approved", "rejected", "responded"].includes(status)) {
      throw new BadRequestException("invalid_status");
    }
    const updated = await this.prisma.budgetRequest.updateMany({
      where: { id, merchantId },
      data: { status },
    });
    if (updated.count !== 1) throw new NotFoundException("budget_request_not_found");
    return { id, status };
  }
}
