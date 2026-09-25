import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { ExperimentMeasurementService } from "../../experiments/application/experiment-measurement.service.js";

@Injectable()
export class StrategyMetricsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly measurement: ExperimentMeasurementService) {}

  /** Server-owned hourly keys bound dashboard polling/retries to one immutable
   * snapshot per execution/hour. This performs no LLM or provider operation. */
  async read(merchantId: string, strategyId: string, version: number, collect = false) {
    if (!Number.isSafeInteger(version) || version < 1) throw new BadRequestException("STRATEGY_INVALID_VERSION");
    if (!await this.prisma.revenueStrategyVersion.findFirst({ where: { merchantId, strategyId, version }, select: { version: true } })) {
      throw new NotFoundException("STRATEGY_VERSION_NOT_FOUND");
    }
    const execution = await this.prisma.strategyExecution.findFirst({ where: { merchantId, strategyId, version },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true, experimentId: true, proposalHash: true, status: true, startedAt: true, endsAt: true, stoppedAt: true } });
    if (!execution) return { strategyId, version, execution: null, measurement: null };
    if (collect) {
      const hour = new Date().toISOString().slice(0, 13).replace(/\D/g, "");
      await this.measurement.capture(merchantId, execution.experimentId, `strategy-hour-${hour}`);
    }
    const review = await this.prisma.experimentMeasurementReview.findFirst({
      where: { merchantId, experimentId: execution.experimentId }, orderBy: [{ collectedAt: "desc" }, { id: "desc" }],
      select: { collectedAt: true, result: true, evidenceHash: true } });
    const { experimentId: _experimentId, ...publicExecution } = execution;
    return { strategyId, version, execution: publicExecution, measurement: review };
  }
}
