import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  BUYER_ADDRESS_REPOSITORY,
  MAX_ADDRESSES_PER_BUYER,
  type BuyerAddressRepository,
} from "../../domain/ports/buyer-address.port.js";
import { BuyerAddress } from "../../domain/entities/buyer-address.entity.js";
import {
  BUYER_ACCOUNT_REPOSITORY,
  type BuyerAccountRepository,
} from "../../domain/ports/buyer-account-repository.port.js";

@Injectable()
export class ListBuyerAddressesUseCase {
  private readonly logger = new Logger(ListBuyerAddressesUseCase.name);

  constructor(
    @Inject(BUYER_ADDRESS_REPOSITORY) private readonly repo: BuyerAddressRepository,
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts?: BuyerAccountRepository,
  ) {}

  async execute(globalUserId: string): Promise<BuyerAddress[]> {
    if (!globalUserId) throw new Error("buyer_address_missing_global_user_id");
    let list = await this.repo.list(globalUserId);

    // Registrations made before saved addresses were introduced keep their
    // delivery address in BuyerAccount.address. Materialize it once so the Hub
    // and checkout use the same canonical address record from now on.
    if (list.length === 0 && this.accounts) {
      const account = await this.accounts.findByGlobalUserId(globalUserId);
      const migrated = account?.address
        ? toSavedAddress(globalUserId, account.address, account.createdAt)
        : null;
      if (migrated) {
        await this.repo.save(migrated);
        list = [migrated];
      }
    }

    // Default address first, then by createdAt asc
    return list.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }
}

function toSavedAddress(
  globalUserId: string,
  address: {
    zip?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  },
  createdAt: Date,
): BuyerAddress | null {
  const zip = address.zip?.trim() ?? "";
  const street = address.street?.trim() ?? "";
  const number = address.number?.trim() ?? "";
  const neighborhood = address.neighborhood?.trim() ?? "";
  const city = address.city?.trim() ?? "";
  const state = address.state?.trim() ?? "";

  if (!zip || !street || !number || !neighborhood || !city || !state) return null;

  try {
    return BuyerAddress.create({
      id: `registration_${globalUserId}`,
      globalUserId,
      zip,
      street,
      number,
      complement: address.complement,
      neighborhood,
      city,
      state,
      isDefault: true,
      createdAt,
    });
  } catch {
    return null;
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
