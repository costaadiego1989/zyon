import { Injectable } from "@nestjs/common";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "../../domain/ports/marketplace-settlement-repository.port.js";
import type {
  MarketplaceSettlementRepository,
  MarketplaceSettlementSnapshot,
} from "../../domain/ports/marketplace-settlement-repository.port.js";

export interface ListSellerSettlementsInput {
  sellerMerchantId: string;
  status?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

export interface ListSellerSettlementsOutput {
  settlements: MarketplaceSettlementSnapshot[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class ListSellerSettlementsUseCase {
  constructor(
    private readonly settlementRepository: MarketplaceSettlementRepository,
  ) {}

  async execute(
    input: ListSellerSettlementsInput,
  ): Promise<ListSellerSettlementsOutput> {
    const settlements = await this.settlementRepository.findBySellerMerchantId(
      input.sellerMerchantId,
    );

    // Filter by status if provided
    let filtered = settlements;
    if (input.status) {
      filtered = filtered.filter((s) => s.status === input.status);
    }

    // Filter by date range if provided
    if (input.createdAfter) {
      filtered = filtered.filter((s) => s.createdAt >= input.createdAfter!);
    }
    if (input.createdBefore) {
      filtered = filtered.filter((s) => s.createdAt <= input.createdBefore!);
    }

    // Sort by createdAt descending (newest first)
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Pagination
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      settlements: paginated,
      total: filtered.length,
      limit,
      offset,
    };
  }
}
