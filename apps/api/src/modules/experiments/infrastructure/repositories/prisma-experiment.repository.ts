import type { PrismaClient } from "@prisma/client";
import { ConflictException } from "@nestjs/common";
import { requiresWeeklyReview } from "../../application/weekly-experiment-governance.js";
import { PromptExperimentEntity, type PromptExperimentSnapshot } from "../../domain/entities/prompt-experiment.entity.js";
import type { PromptVariantSnapshot } from "../../domain/entities/prompt-variant.entity.js";
import type { ExperimentRepositoryPort } from "../../domain/ports/experiment-repository.port.js";

export class PrismaExperimentRepository implements ExperimentRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async save(experiment: PromptExperimentEntity): Promise<void> {
    const snapshot = experiment.snapshot();
    await this.prisma.$transaction(async tx => {
      const [current] = await tx.$queryRaw<{ id: string; merchant_id: string; status: string }[]>`
        SELECT id, merchant_id, status FROM prompt_experiments WHERE id = ${snapshot.id} FOR UPDATE`;
      if (current && current.merchant_id !== snapshot.merchant_id) throw new Error("EXPERIMENT_NOT_FOUND");
      const transitions: Record<string, string[]> = { draft: ["running"], running: ["completed"], completed: ["archived"], archived: [] };
      if (current && current.status !== snapshot.status && !transitions[current.status]?.includes(snapshot.status)) {
        throw new ConflictException("EXPERIMENT_STATE_CHANGED");
      }
      const plan = current ? await tx.experimentMeasurementPlan.findUnique({ where: { experimentId: snapshot.id } }) : null;
      if (plan && snapshot.status === "draft") throw new ConflictException("EXPERIMENT_PLAN_IMMUTABLE");
      if (snapshot.status === "running" && current?.status !== "running"
        && (plan || await requiresWeeklyReview(tx as unknown as PrismaClient, snapshot.merchant_id))) {
        // Measurement registration is not versioned merchant approval. RI-07/09
        // will provide a separate transactional activation path and faithful baseline.
        throw new ConflictException("EXPERIMENT_VERSIONED_APPROVAL_REQUIRED");
      }
      const data = {
        name: snapshot.name,
        description: snapshot.description,
        status: snapshot.status,
        startedAt: snapshot.started_at ? new Date(snapshot.started_at) : null,
        completedAt: snapshot.completed_at ? new Date(snapshot.completed_at) : null,
        winnerVariantId: snapshot.winner_variant_id,
        updatedAt: new Date(snapshot.updated_at),
      };
      if (!current) await tx.promptExperiment.create({ data: {
        ...data, id: snapshot.id, merchantId: snapshot.merchant_id, createdAt: new Date(snapshot.created_at),
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
      } });
      else await tx.promptExperiment.update({ where: { id: snapshot.id, merchantId: snapshot.merchant_id }, data });

      // Draft changes and variant replacement share the registration lock.
      if (current && snapshot.status === "draft") {
        await tx.promptVariant.deleteMany({ where: { experimentId: snapshot.id } });
        await tx.promptVariant.createMany({
          data: snapshot.variants.map((v) => ({
            id: v.id, experimentId: v.experiment_id, name: v.name, systemPrompt: v.system_prompt,
            weight: v.weight, isControl: v.is_control, appliedRuleId: v.applied_rule_id ?? null,
            createdAt: new Date(v.created_at), updatedAt: new Date(v.updated_at),
          })),
        });
      }
    });
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
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM prompt_experiments WHERE id = ${id} AND merchant_id = ${merchantId} FOR UPDATE`;
      if (await tx.experimentMeasurementPlan.findFirst({ where: { experimentId: id, merchantId } })) {
        throw new ConflictException("EXPERIMENT_PLAN_IMMUTABLE");
      }
      await tx.promptVariant.deleteMany({ where: { experiment: { merchantId }, experimentId: id } });
      await tx.promptExperiment.deleteMany({ where: { id, merchantId } });
    });
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

