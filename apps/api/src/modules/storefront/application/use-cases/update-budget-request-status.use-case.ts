import { Inject, Injectable, BadRequestException, NotFoundException , Logger} from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export type BudgetRequestStatus = "approved" | "rejected" | "responded";

@Injectable()
export class UpdateBudgetRequestStatusUseCase {
  private readonly logger = new Logger(UpdateBudgetRequestStatusUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(id: string, status: BudgetRequestStatus, merchantId: string): Promise<{ id: string; status: string }> {
    if (!["approved", "rejected", "responded"].includes(status)) {
      throw new BadRequestException("invalid_status");
    }
    if (!merchantId) throw new NotFoundException("budget_request_not_found");
    const existing = await this.prisma.budgetRequest.findFirst({ where: { id, merchantId } });
    if (!existing) throw new NotFoundException("budget_request_not_found");

    const updated = await this.prisma.budgetRequest.update({
      where: { id, merchantId },
      data: { status },
    });
    return { id: updated.id, status: updated.status };
  }
}
