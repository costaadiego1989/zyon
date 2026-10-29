import type { PrismaClient } from "@prisma/client";
import {
  BuyerEarnedBenefitEntity,
  type BuyerBenefitOrigin,
  type BuyerBenefitStatus,
  type BuyerBenefitType,
  type BuyerEarnedBenefitSnapshot,
} from "../domain/entities/buyer-earned-benefit.entity.js";
import type {
  BuyerEarnedBenefitRepositoryPort,
  CreateBuyerEarnedBenefitInput,
} from "../domain/ports/buyer-earned-benefit.repository.port.js";

type BenefitRow = {
  id: string;
  merchantId: string;
  globalUserId: string;
  benefitType: string;
  value: number;
  origin: string;
  reason: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
};

type BenefitDelegate = {
  create: (args: { data: Record<string, unknown> }) => Promise<BenefitRow>;
  findMany: (args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }) => Promise<BenefitRow[]>;
};

export class PrismaBuyerEarnedBenefitRepository implements BuyerEarnedBenefitRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  private get delegate(): BenefitDelegate {
    return (this.prisma as unknown as { buyerEarnedBenefit: BenefitDelegate }).buyerEarnedBenefit;
  }

  async create(input: CreateBuyerEarnedBenefitInput): Promise<BuyerEarnedBenefitSnapshot> {
    // Validate through the domain entity before persisting.
    const entity = BuyerEarnedBenefitEntity.create(input);
    const snap = entity.snapshot();

    const row = await this.delegate.create({
      data: {
        merchantId: snap.merchantId,
        globalUserId: snap.globalUserId,
        benefitType: snap.benefitType,
        value: snap.value,
        origin: snap.origin,
        reason: snap.reason,
        status: snap.status,
        expiresAt: snap.expiresAt ? new Date(snap.expiresAt) : null,
      },
    });

    return toSnapshot(row);
  }

  async listActive(
    merchantId: string,
    globalUserId: string
  ): Promise<BuyerEarnedBenefitSnapshot[]> {
    const now = new Date();
    const rows = await this.delegate.findMany({
      where: {
        merchantId,
        globalUserId,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toSnapshot);
  }
}

function toSnapshot(row: BenefitRow): BuyerEarnedBenefitSnapshot {
  return {
    id: row.id,
    merchantId: row.merchantId,
    globalUserId: row.globalUserId,
    benefitType: row.benefitType as BuyerBenefitType,
    value: row.value,
    origin: row.origin as BuyerBenefitOrigin,
    reason: row.reason,
    status: row.status as BuyerBenefitStatus,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
