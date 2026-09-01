import type { PrismaClient } from "@prisma/client";
import { PromptExperimentEntity, type PromptExperimentSnapshot } from "../../domain/entities/prompt-experiment.entity.js";
import type { PromptVariantSnapshot } from "../../domain/entities/prompt-variant.entity.js";
import type { ExperimentRepositoryPort } from "../../domain/ports/experiment-repository.port.js";

export class PrismaExperimentRepository implements ExperimentRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async save(experiment: PromptExperimentEntity): Promise<void> {
    const snapshot = experiment.snapshot();
    await this.prisma.promptExperiment.upsert({
      where: { id: snapshot.id },
      create: {
        id: snapshot.id,
        merchantId: snapshot.merchant_id,
        name: snapshot.name,
        description: snapshot.description,
        status: snapshot.status,
        startedAt: snapshot.started_at ? new Date(snapshot.started_at) : null,
        completedAt: snapshot.completed_at ? new Date(snapshot.completed_at) : null,
        winnerVariantId: snapshot.winner_variant_id,
        createdAt: new Date(snapshot.created_at),
        updatedAt: new Date(snapshot.updated_at),
        variants: {
          createMany: {
            data: snapshot.variants.map((v) => ({
              id: v.id,
              name: v.name,
              systemPrompt: v.system_prompt,
              weight: v.weight,
              isControl: v.is_control,
              appliedRuleId: v.applied_rule_id ?? null,
              createdAt: new Date(v.created_at),
              updatedAt: new Date(v.updated_at),
            })),
          },
        },
      },
      update: {
        name: snapshot.name,
        description: snapshot.description,
        status: snapshot.status,
        startedAt: snapshot.started_at ? new Date(snapshot.started_at) : null,
        completedAt: snapshot.completed_at ? new Date(snapshot.completed_at) : null,
        winnerVariantId: snapshot.winner_variant_id,
        updatedAt: new Date(snapshot.updated_at),
      },
    });

    // Clean up old variants and recreate if changed
    if (snapshot.status === "draft") {
      await this.prisma.promptVariant.deleteMany({
        where: { experimentId: snapshot.id },
      });
      await this.prisma.promptVariant.createMany({
        data: snapshot.variants.map((v) => ({
          id: v.id,
          experimentId: v.experiment_id,
          name: v.name,
          systemPrompt: v.system_prompt,
          weight: v.weight,
          isControl: v.is_control,
          appliedRuleId: v.applied_rule_id ?? null,
          createdAt: new Date(v.created_at),
          updatedAt: new Date(v.updated_at),
        })),
      });
    }
  }

  async findById(id: string, merchantId: string): Promise<PromptExperimentEntity | null> {
    const row = await this.prisma.promptExperiment.findFirst({
      where: { id, merchantId },
      include: { variants: true },
    });
    if (!row) return null;
    return PromptExperimentEntity.rehydrate(this.toSnapshot(row));
  }

  async findByMerchant(merchantId: string): Promise<PromptExperimentEntity[]> {
    const rows = await this.prisma.promptExperiment.findMany({
      where: { merchantId },
      include: { variants: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => PromptExperimentEntity.rehydrate(this.toSnapshot(row)));
  }

  async findRunning(merchantId: string): Promise<PromptExperimentEntity | null> {
    const row = await this.prisma.promptExperiment.findFirst({
      where: { merchantId, status: "running" },
      include: { variants: true },
    });
    if (!row) return null;
    return PromptExperimentEntity.rehydrate(this.toSnapshot(row));
  }

  async delete(id: string, merchantId: string): Promise<void> {
    await this.prisma.promptVariant.deleteMany({ where: { experiment: { merchantId }, experimentId: id } });
    await this.prisma.promptExperiment.deleteMany({ where: { id, merchantId } });
  }

  private toSnapshot(row: any): PromptExperimentSnapshot {
    return {
      id: row.id,
      merchant_id: row.merchantId,
      name: row.name,
      description: row.description,
      status: row.status,
      variants: row.variants.map((v: any) => ({
        id: v.id,
        experiment_id: v.experimentId,
        name: v.name,
        system_prompt: v.systemPrompt,
        weight: v.weight,
        is_control: v.isControl,
        applied_rule_id: v.appliedRuleId ?? null,
        created_at: v.createdAt.toISOString(),
        updated_at: v.updatedAt.toISOString(),
      })) as PromptVariantSnapshot[],
      started_at: row.startedAt?.toISOString() ?? null,
      completed_at: row.completedAt?.toISOString() ?? null,
      winner_variant_id: row.winnerVariantId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}

