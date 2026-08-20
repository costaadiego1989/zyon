import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { ObservationEntity, type ObservationSnapshot } from "../domain/entities/observation.entity.js";
import type { ObservationRepositoryPort } from "../domain/ports/observation-repository.port.js";

export class PrismaObservationRepository implements ObservationRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async save(observation: ObservationEntity): Promise<void> {
    const snap = observation.snapshot();
    await this.prisma.revenueManagerObservation.upsert({
      where: { id: snap.id },
      create: {
        id: snap.id,
        merchantId: snap.merchant_id,
        observationWindowStart: new Date(snap.observation_window_start),
        observationWindowEnd: new Date(snap.observation_window_end),
        funnelJson: snap.funnel,
        abandonmentJson: snap.abandonment,
        objectionsJson: snap.objections,
        crossSellJson: snap.cross_sell,
        currentExperimentJson: snap.current_experiment ?? Prisma.DbNull,
        cohortsJson: snap.cohorts,
        revenueJson: snap.revenue,
        aiCostsCents: snap.ai_costs_cents,
        fingerprint: snap.fingerprint,
      },
      update: {
        funnelJson: snap.funnel,
        abandonmentJson: snap.abandonment,
        objectionsJson: snap.objections,
        crossSellJson: snap.cross_sell,
        currentExperimentJson: snap.current_experiment ?? Prisma.DbNull,
        cohortsJson: snap.cohorts,
        revenueJson: snap.revenue,
        aiCostsCents: snap.ai_costs_cents,
      },
    });
  }

  async findById(id: string, merchantId: string): Promise<ObservationEntity | null> {
    const rec = await this.prisma.revenueManagerObservation.findUnique({
      where: { id },
    });
    if (!rec || rec.merchantId !== merchantId) return null;
    return ObservationEntity.rehydrate(this.toDomain(rec));
  }

  async findByFingerprint(fingerprint: string): Promise<ObservationEntity | null> {
    const rec = await this.prisma.revenueManagerObservation.findUnique({
      where: { fingerprint },
    });
    return rec ? ObservationEntity.rehydrate(this.toDomain(rec)) : null;
  }

  async findLatestByMerchant(merchantId: string): Promise<ObservationEntity | null> {
    const rec = await this.prisma.revenueManagerObservation.findFirst({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
    });
    return rec ? ObservationEntity.rehydrate(this.toDomain(rec)) : null;
  }

  async findByMerchant(merchantId: string, limit = 10): Promise<ObservationEntity[]> {
    const recs = await this.prisma.revenueManagerObservation.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return recs.map((r) => ObservationEntity.rehydrate(this.toDomain(r)));
  }

  private toDomain(rec: {
    id: string;
    merchantId: string;
    observationWindowStart: Date;
    observationWindowEnd: Date;
    funnelJson: unknown;
    abandonmentJson: unknown;
    objectionsJson: unknown;
    crossSellJson: unknown;
    currentExperimentJson: unknown;
    cohortsJson: unknown;
    revenueJson: unknown;
    aiCostsCents: number;
    fingerprint: string;
    createdAt: Date;
  }): ObservationSnapshot {
    return {
      id: rec.id,
      merchant_id: rec.merchantId,
      observation_window_start: rec.observationWindowStart.toISOString(),
      observation_window_end: rec.observationWindowEnd.toISOString(),
      funnel: rec.funnelJson as ObservationSnapshot["funnel"],
      abandonment: rec.abandonmentJson as ObservationSnapshot["abandonment"],
      objections: rec.objectionsJson as ObservationSnapshot["objections"],
      cross_sell: rec.crossSellJson as ObservationSnapshot["cross_sell"],
      current_experiment: rec.currentExperimentJson as ObservationSnapshot["current_experiment"],
      cohorts: rec.cohortsJson as ObservationSnapshot["cohorts"],
      revenue: rec.revenueJson as ObservationSnapshot["revenue"],
      ai_costs_cents: rec.aiCostsCents,
      fingerprint: rec.fingerprint,
      created_at: rec.createdAt.toISOString(),
    };
  }
}
