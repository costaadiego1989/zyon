import { Inject, Injectable } from "@nestjs/common";
import {
  BUYER_ADDRESS_REPOSITORY,
  MAX_ADDRESSES_PER_BUYER,
  type BuyerAddressRepository,
} from "../../domain/ports/buyer-address.port.js";
import type { BuyerAddress } from "../../domain/entities/buyer-address.entity.js";

@Injectable()
export class ListBuyerAddressesUseCase {
  constructor(@Inject(BUYER_ADDRESS_REPOSITORY) private readonly repo: BuyerAddressRepository) {}

  async execute(globalUserId: string): Promise<BuyerAddress[]> {
    if (!globalUserId) throw new Error("buyer_address_missing_global_user_id");
    const list = await this.repo.list(globalUserId);
    // Default address first, then by createdAt asc
    return list.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }
}

@Injectable()
export class AddBuyerAddressUseCase {
  constructor(@Inject(BUYER_ADDRESS_REPOSITORY) private readonly repo: BuyerAddressRepository) {}

  async execute(input: {
    globalUserId: string;
    id: string;
    zip: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    isDefault: boolean;
  }): Promise<BuyerAddress> {
    if (!input.globalUserId) throw new Error("buyer_address_missing_global_user_id");

    const count = await this.repo.count(input.globalUserId);
    if (count >= MAX_ADDRESSES_PER_BUYER) {
      throw new Error(`buyer_address_max_${MAX_ADDRESSES_PER_BUYER}_reached`);
    }

    const { BuyerAddress } = await import("../../domain/entities/buyer-address.entity.js");
    const address = BuyerAddress.create(input);

    if (address.isDefault) {
      await this.repo.clearDefaults(input.globalUserId);
    }
    await this.repo.save(address);
    return address;
  }
}

@Injectable()
export class UpdateBuyerAddressUseCase {
  constructor(@Inject(BUYER_ADDRESS_REPOSITORY) private readonly repo: BuyerAddressRepository) {}

  async execute(input: {
    globalUserId: string;
    id: string;
    zip?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    isDefault?: boolean;
  }): Promise<BuyerAddress> {
    if (!input.globalUserId) throw new Error("buyer_address_missing_global_user_id");
    const existing = await this.repo.findById(input.globalUserId, input.id);
    if (!existing) throw new Error("buyer_address_not_found");

    const updated = existing.withUpdates(input);

    // If we're flipping default=true, clear other defaults first
    if (input.isDefault === true && !existing.isDefault) {
      await this.repo.clearDefaults(input.globalUserId);
    }
    await this.repo.save(updated);
    return updated;
  }
}

@Injectable()
export class DeleteBuyerAddressUseCase {
  constructor(@Inject(BUYER_ADDRESS_REPOSITORY) private readonly repo: BuyerAddressRepository) {}

  async execute(input: { globalUserId: string; id: string }): Promise<void> {
    if (!input.globalUserId) throw new Error("buyer_address_missing_global_user_id");
    const existing = await this.repo.findById(input.globalUserId, input.id);
    if (!existing) throw new Error("buyer_address_not_found");
    await this.repo.delete(input.globalUserId, input.id);
  }
}
