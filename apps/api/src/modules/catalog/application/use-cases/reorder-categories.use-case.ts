import { Injectable, Inject , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface ReorderCategoryItem {
  id: string;
  sort_order: number;
}

export interface ReorderCategoriesPayload {
  items: ReorderCategoryItem[];
}

@Injectable()
export class ReorderCategoriesUseCase {
  private readonly logger = new Logger(ReorderCategoriesUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, input: ReorderCategoryItem[] | ReorderCategoriesPayload): Promise<void> {
    const items = Array.isArray(input) ? input : input?.items;
    if (!items?.length) return;

    const ids = items.map((i) => i.id);
    const owned = await this.prisma.productCategory.findMany({
      where: { id: { in: ids }, merchantId },
      select: { id: true },
    });

    if (owned.length !== ids.length) {
      throw new Error("category_not_found");
    }

    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.productCategory.update({
          where: { id: item.id },
          data: { sortOrder: item.sort_order },
        }),
      ),
    );
  }
}
