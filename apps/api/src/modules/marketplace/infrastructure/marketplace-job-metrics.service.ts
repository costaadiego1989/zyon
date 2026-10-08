import { Injectable } from "@nestjs/common";
import { Counter, Gauge } from "prom-client";
import { MetricsService } from "../../../shared/observability/metrics.service.js";

type Job = "catalog" | "funding" | "payouts" | "refunds" | "recovery";
type Outcome = "success" | "partial" | "failure";
type Scope = "products" | "projections";

/** Bounded process-local job health. Financial balances remain database backed. */
@Injectable()
export class MarketplaceJobMetricsService {
  private readonly runs: Counter<"worker" | "outcome">;
  private readonly running: Gauge<"worker">;
  private readonly completed: Gauge<"worker">;
  private readonly cycleFailures: Gauge<"scope">;
  private readonly cycleCompleted: Gauge<"scope">;

  constructor(metrics: MetricsService) {
    const registers = [metrics.registry];
    this.runs = new Counter({ name: "marketplace_job_runs_total", help: "Marketplace background runs by worker and bounded outcome", labelNames: ["worker", "outcome"], registers });
    this.running = new Gauge({ name: "marketplace_job_running", help: "Whether a marketplace background job is currently running", labelNames: ["worker"], registers });
    this.completed = new Gauge({ name: "marketplace_job_completed_timestamp_seconds", help: "Last completed marketplace background run, including failed runs", labelNames: ["worker"], registers });
    this.cycleFailures = new Gauge({ name: "marketplace_catalog_cycle_failures", help: "Failed rows in the last complete catalog scan; cleared only by a clean cycle", labelNames: ["scope"], registers });
    this.cycleCompleted = new Gauge({ name: "marketplace_catalog_cycle_completed_timestamp_seconds", help: "Last complete catalog scan by bounded scope", labelNames: ["scope"], registers });
    for (const job of ["catalog", "funding", "payouts", "refunds", "recovery"] as const) {
      this.running.set({ worker: job }, 0);
      this.completed.set({ worker: job }, 0);
      for (const outcome of ["success", "partial", "failure"] as const) this.runs.inc({ worker: job, outcome }, 0);
    }
    for (const scope of ["products", "projections"] as const) {
      this.cycleFailures.set({ scope }, 0);
      this.cycleCompleted.set({ scope }, 0);
    }
  }

  start(job: Job): void { this.running.set({ worker: job }, 1); }
  finish(job: Job, outcome: Outcome): void {
    this.runs.inc({ worker: job, outcome });
    this.running.set({ worker: job }, 0);
    this.completed.set({ worker: job }, Date.now() / 1000);
  }
  catalogCycle(scope: Scope, failures: number): void {
    this.cycleFailures.set({ scope }, failures);
    this.cycleCompleted.set({ scope }, Date.now() / 1000);
  }
}
