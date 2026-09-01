import {
  BuyerEarnedBenefitEntity,
  type BuyerEarnedBenefitSnapshot,
} from "../domain/entities/buyer-earned-benefit.entity.js";
import type {
  BuyerEarnedBenefitRepositoryPort,
  CreateBuyerEarnedBenefitInput,
} from "../domain/ports/buyer-earned-benefit.repository.port.js";

/**
 * In-memory test double. Constructed directly in specs — never wired via module roots.
 */
export class InMemoryBuyerEarnedBenefitRepository implements BuyerEarnedBenefitRepositoryPort {
  private readonly rows: BuyerEarnedBenefitSnapshot[] = [];
  private seq = 0;

  async create(input: CreateBuyerEarnedBenefitInput): Promise<BuyerEarnedBenefitSnapshot> {
    const entity = BuyerEarnedBenefitEntity.create(input);
    const snap = { ...entity.snapshot(), id: `beb_${++this.seq}` };
    this.rows.push(snap);
    return { ...snap };
  }

  async listActive(
    merchantId: string,
    globalUserId: string
  ): Promise<BuyerEarnedBenefitSnapshot[]> {
    const now = Date.now();
    return this.rows
      .filter(
        (r) =>
          r.merchantId === merchantId &&
          r.globalUserId === globalUserId &&
          r.status === "active" &&
          (!r.expiresAt || new Date(r.expiresAt).getTime() > now)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r }));
  }

  /** Test helper. */
  all(): BuyerEarnedBenefitSnapshot[] {
    return this.rows.map((r) => ({ ...r }));
  }
}
