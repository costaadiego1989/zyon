import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PromptExperimentEntity } from "../../domain/entities/prompt-experiment.entity.js";
import type { ExperimentRepositoryPort } from "../../domain/ports/experiment-repository.port.js";
import { GetExperimentResultsUseCase } from "./get-experiment-results.use-case.js";
import { ListExperimentsUseCase } from "./list-experiments.use-case.js";
import { ArchiveExperimentUseCase } from "./archive-experiment.use-case.js";

function fixture() {
  return PromptExperimentEntity.create({ merchant_id: "merchant", name: "QA draft", variants: [
    { name: "Control", system_prompt: "Baseline", weight: 50, is_control: true },
    { name: "Challenger", system_prompt: "Approved alternative", weight: 50, is_control: false },
  ] });
}

test("list and detail reconcile 553 sessions; ticket divides BRL revenue by sales", async () => {
  const experiment = fixture().start().complete();
  const [control, challenger] = experiment.variants;
  const rows = [
    ...Array.from({ length: 294 }, (_, index) => ({ variantId: control.id, converted: index === 0, revenue: index === 0 ? 29.9 : 0 })),
    ...Array.from({ length: 259 }, () => ({ variantId: challenger.id, converted: false, revenue: 0 })),
    { variantId: "other-merchant", converted: true, revenue: 9999 },
  ];
  let aggregateQueries = 0;
  const prisma = { promptVariantResult: {
    findMany: async (query: any) => rows.filter(row => query.where.variantId.in.includes(row.variantId)),
    groupBy: async (query: any) => {
      aggregateQueries++;
      const filtered = rows.filter(row => query.where.variantId.in.includes(row.variantId) && (!query.where.converted || row.converted));
      return [...new Set(filtered.map(row => row.variantId))].map(variantId => ({ variantId,
        _count: { _all: filtered.filter(row => row.variantId === variantId).length },
        _sum: { revenue: filtered.filter(row => row.variantId === variantId).reduce((sum, row) => sum + row.revenue, 0) },
      }));
    },
  } } as unknown as PrismaClient;
  const repository = { findById: async (_id: string, merchant: string) => merchant === "merchant" ? experiment : null, findByMerchant: async () => [experiment] } as unknown as ExperimentRepositoryPort;
  const detail = await new GetExperimentResultsUseCase(repository, prisma).execute(experiment.id, "merchant");
  const list = await new ListExperimentsUseCase(repository, prisma).execute("merchant");
  assert.equal(detail!.variants.reduce((sum, row) => sum + row.sample_size, 0), 553);
  assert.equal(list[0].metrics.reduce((sum, row) => sum + row.total_visitors, 0), 553);
  assert.equal(list[0].metrics.reduce((sum, row) => sum + row.revenue, 0), 29.9);
  assert.equal(detail!.variants[0].avg_order_value, 29.9);
  assert.equal(detail!.variants[0].avg_revenue, 0.1);
  assert.equal(detail!.variants[1].avg_order_value, 0);
  assert.equal(aggregateQueries, 2);
  assert.equal(await new GetExperimentResultsUseCase(repository, prisma).execute(experiment.id, "other"), null);
});

test("archive a draft without starting, timestamps or variant changes; running archive is refused", async () => {
  let stored = fixture();
  const baseline = stored.snapshot();
  const repository = { findById: async (id: string, merchant: string) => id === stored.id && merchant === stored.merchant_id ? stored : null,
    save: async (next: PromptExperimentEntity) => { stored = next; },
  } as unknown as ExperimentRepositoryPort;
  const archive = new ArchiveExperimentUseCase(repository);
  await archive.execute({ merchant_id: "merchant", experiment_id: stored.id });
  assert.equal(stored.status, "archived");
  assert.equal(stored.started_at, null);
  assert.equal(stored.completed_at, null);
  assert.deepEqual(stored.variants, baseline.variants);
  assert.throws(() => fixture().start().archive(), /INVALID_TRANSITION/);
  await assert.rejects(archive.execute({ merchant_id: "other", experiment_id: stored.id }), /EXPERIMENT_NOT_FOUND/);
});
