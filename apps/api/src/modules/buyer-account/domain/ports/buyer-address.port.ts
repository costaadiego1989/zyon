import type { BuyerAddress } from "../entities/buyer-address.entity.js";

export const BUYER_ADDRESS_REPOSITORY = Symbol("BUYER_ADDRESS_REPOSITORY");

/**
 * Buyer address persistence boundary. All methods MUST be scoped by
 * `globalUserId` (LGPD/tenant-boundary invariant per CLAUDE.md). In-memory
 * implementations exist only as test doubles.
 */
export interface BuyerAddressRepository {
  list(globalUserId: string): Promise<BuyerAddress[]>;
  findById(globalUserId: string, id: string): Promise<BuyerAddress | null>;
  save(address: BuyerAddress): Promise<void>;
  delete(globalUserId: string, id: string): Promise<void>;
  count(globalUserId: string): Promise<number>;
  /** Atomically clear isDefault on all buyer addresses; called when adding a new default. */
  clearDefaults(globalUserId: string): Promise<void>;
}

export const MAX_ADDRESSES_PER_BUYER = 5;
