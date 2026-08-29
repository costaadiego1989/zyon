import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { BuyerAccountModule } from "../buyer-account/buyer-account.module.js";
import { SupportModule } from "../support/support.module.js";
import { RETURN_REPOSITORY_PORT } from "./domain/ports/return-repository.port.js";
import { PrismaReturnRepository } from "./infrastructure/repositories/prisma-return.repository.js";
import { RequestReturnUseCase } from "./application/use-cases/request-return.use-case.js";
import { GenerateReturnLabelUseCase } from "./application/use-cases/generate-return-label.use-case.js";
import { MarkReturnReceivedUseCase } from "./application/use-cases/mark-return-received.use-case.js";
import { InspectReturnUseCase } from "./application/use-cases/inspect-return.use-case.js";
import { ProcessRefundUseCase } from "./application/use-cases/process-refund.use-case.js";
import { RestockInventoryUseCase } from "./application/use-cases/restock-inventory.use-case.js";
import { ListReturnsUseCase } from "./application/use-cases/list-returns.use-case.js";
import { ReturnsController } from "./presentation/http/returns.controller.js";
import { BuyerReturnsController } from "./presentation/http/buyer-returns.controller.js";

@Module({
  imports: [PersistenceModule, BuyerAccountModule, SupportModule],
  controllers: [ReturnsController, BuyerReturnsController],
  providers: [
    {
      provide: RETURN_REPOSITORY_PORT,
      useFactory: (prisma: PrismaClient) => new PrismaReturnRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    RequestReturnUseCase,
    GenerateReturnLabelUseCase,
    MarkReturnReceivedUseCase,
    InspectReturnUseCase,
    ProcessRefundUseCase,
    RestockInventoryUseCase,
    ListReturnsUseCase,
  ],
  exports: [
    RETURN_REPOSITORY_PORT,
    RequestReturnUseCase,
    ListReturnsUseCase,
  ],
})
export class ReturnsModule {}
