import { Injectable, Inject, ConflictException , Logger} from "@nestjs/common";
import { StockRepositoryPort, ReserveStockInput, ReserveStockResult } from "../../domain/ports/product-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class ReserveStockUseCase {
  private readonly logger = new Logger(ReserveStockUseCase.name);

  constructor(@Inject("StockRepositoryPort") private readonly stockRepo: StockRepositoryPort) {}

  async execute(input: ReserveStockInput): Promise<ReserveStockResult> {
    if (input.quantity <= 0) {
      throw new ConflictException("quantity_must_be_positive");
    }

    try {
      return await this.stockRepo.reserve(input);
    } catch (err: any) {
      if (err.message === "insufficient_stock") {
        throw new ConflictException("insufficient_stock");
      }
      if (err.message === "stock_not_found") {
        throw new ConflictException("variant_not_found");
      }
      throw err;
    }
  }
}