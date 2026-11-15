import { lockCatalogMerchant } from "../../../../shared/persistence/catalog-stock-ledger.js";
import { enqueueCanonicalPublicBusinessSources } from "../../../graph-rag/infrastructure/public-business-write.js";
import { Injectable, Inject , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class DeleteCategoryUseCase {
  private readonly logger = new Logger(DeleteCategoryUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, categoryId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await lockCatalogMerchant(tx, merchantId);
      const category = await tx.productCategory.findFirst({ where: { id: categoryId, merchantId } });
      if (!category) throw new Error("category_not_found");
      const affected = await tx.product.findMany({ where: { merchantId, categoryId, type: "service" }, select: { id: true } });
      await tx.productCategory.updateMany({ where: { merchantId, parentId: categoryId }, data: { parentId: null } });
      await tx.product.updateMany({ where: { merchantId, categoryId }, data: { categoryId: null } });
      await tx.productCategory.delete({ where: { id: categoryId, merchantId } });
      await enqueueCanonicalPublicBusinessSources(tx, merchantId, affected.map(row => ({ sourceType: "service", sourceId: row.id })));
    });
  }
}
