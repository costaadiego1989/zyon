import { Injectable, Inject, ConflictException, ForbiddenException , Logger} from "@nestjs/common";
import { StockRepositoryPort } from "../../domain/ports/product-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class ConfirmStockUseCase {
  private readonly logger = new Logger(ConfirmStockUseCase.name);

  constructor(@Inject("StockRepositoryPort") private readonly stockRepo: StockRepositoryPort) {}

  async execute(merchantId: string, reservationId: string): Promise<void> {
    try {
      await this.stockRepo.confirm(merchantId, reservationId);
    } catch (err: any) {
      if (err.message === "reservation_not_found") throw new ConflictException("reservation_not_found");
      if (err.message === "forbidden") throw new ForbiddenException("reservation_not_owned");
      if (err.message === "reservation_not_active") throw new ConflictException("reservation_not_active");
      throw err;
    }
  }
}