import { Inject, Injectable , Logger} from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { BudgetRequestDto } from "./create-budget-request.use-case.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class ListBudgetRequestsUseCase {
  private readonly logger = new Logger(ListBudgetRequestsUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string): Promise<BudgetRequestDto[]> {
    const requests = await this.prisma.budgetRequest.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return requests.map((r) => ({
      id: r.id,
      merchantId: r.merchantId,
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      customerPhone: r.customerPhone,
      items: r.items,
      total: r.total,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
