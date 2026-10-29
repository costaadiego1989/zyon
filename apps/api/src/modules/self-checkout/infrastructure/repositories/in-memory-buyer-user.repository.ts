import { Injectable } from "@nestjs/common";
import { BuyerUserEntity } from "../../domain/entities/buyer-user.entity.js";
import type { BuyerUserRepository } from "../../domain/ports/buyer-user-repository.port.js";

@Injectable()
export class InMemoryBuyerUserRepository implements BuyerUserRepository {
  private readonly store = new Map<string, ReturnType<BuyerUserEntity["snapshot"]>>();

  async findById(id: string) {
    const data = this.store.get(id);
    return data ? BuyerUserEntity.rehydrate(data) : null;
  }

  /** P2 fix: case-insensitive lookup — normalise to lowercase before comparing. */
  async findByEmail(email: string) {
    const normalised = email.trim().toLowerCase();
    for (const data of this.store.values()) {
      if (data.email.toLowerCase() === normalised) return BuyerUserEntity.rehydrate(data);
    }
    return null;
  }

  async save(user: BuyerUserEntity) {
    this.store.set(user.id, user.snapshot());
  }
}
