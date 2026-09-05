import { Injectable, Inject, ConflictException, NotFoundException, Logger} from "@nestjs/common";
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
    if (!Number.isSafeInteger(input.quantity)) throw new ConflictException("invalid_stock_quantity");
    if (!input.idempotencyKey?.trim()) throw new ConflictException("idempotency_key_required");

    try {
      return await this.stockRepo.reserve(input);
    } catch (err: any) {
      if (err.message === "insufficient_stock") {
        throw new ConflictException("insufficient_stock");
      }
      if (err.message === "stock_not_found") {
        throw new NotFoundException("variant_not_found");
      }
      if (["reservation_idempotency_conflict", "reservation_not_active"].includes(err.message)) throw new ConflictException(err.message);
      throw err;
    }
  }
}
