import { Injectable } from "@nestjs/common";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import { OnSaleCompletedHandler } from "../../infrastructure/event-handlers/on-sale-completed.handler.js";

export type HandleSaleCompletedOutput = {
  stockDecrementedCount: number;
  integrationJobsQueued: number;
  idempotent: boolean;
  receiptId: string;
};

/** Stock and durable integration jobs commit together; providers run in separate deliveries. */
@Injectable()
export class HandleSaleCompletedUseCase {
  constructor(private readonly stockHandler: OnSaleCompletedHandler) {}
  async execute(event: SaleCompletedEvent): Promise<HandleSaleCompletedOutput> {
    const sale = await this.stockHandler.handle(event);
    return { stockDecrementedCount: sale.idempotent ? 0 : sale.stockDecrementedCount,
      integrationJobsQueued: sale.idempotent ? 0 : 3, idempotent: sale.idempotent, receiptId: sale.receiptId };
  }
}
