import { Inject, Injectable, Logger } from "@nestjs/common";
import { EXPERIMENT_REPOSITORY_PORT, type ExperimentRepositoryPort } from "../../domain/ports/experiment-repository.port.js";
import type { PromptExperimentSnapshot } from "../../domain/entities/prompt-experiment.entity.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

type ExperimentListItem = PromptExperimentSnapshot & {
  metrics: Array<{ experiment_id: string; variant_id: string; total_visitors: number; conversions: number; conversion_rate: number; revenue: number }>;
};

@Injectable()
export class ListExperimentsUseCase {
  private readonly logger = new Logger(ListExperimentsUseCase.name);

  constructor(
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly repository: ExperimentRepositoryPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(merchantId: string): Promise<ExperimentListItem[]> {
    const experiments = await this.repository.findByMerchant(merchantId);
    const variantIds = experiments.flatMap(experiment => experiment.variants.map(variant => variant.id));
    if (!variantIds.length) return experiments.map(experiment => ({ ...experiment.snapshot(), metrics: [] }));
    // Two aggregate reads for the entire tenant list instead of one results
    // request per card or loading every session result into memory.
    const [totals, converted] = await Promise.all([
      this.prisma.promptVariantResult.groupBy({ by: ["variantId"], where: { variantId: { in: variantIds } }, _count: { _all: true }, _sum: { revenue: true } }),
      this.prisma.promptVariantResult.groupBy({ by: ["variantId"], where: { variantId: { in: variantIds }, converted: true }, _count: { _all: true } }),
    ]);
    return experiments.map(experiment => ({
      ...experiment.snapshot(),
      metrics: experiment.variants.map(variant => {
        const total = totals.find(row => row.variantId === variant.id);
        const visitors = total?._count._all ?? 0;
        const conversions = converted.find(row => row.variantId === variant.id)?._count._all ?? 0;
        return {
          experiment_id: experiment.id, variant_id: variant.id,
          total_visitors: visitors, conversions,
          conversion_rate: visitors ? Math.round(conversions / visitors * 10000) / 100 : 0,
          revenue: Math.round(Number(total?._sum.revenue ?? 0) * 100) / 100,
        };
      }),
    }));
  }
}
