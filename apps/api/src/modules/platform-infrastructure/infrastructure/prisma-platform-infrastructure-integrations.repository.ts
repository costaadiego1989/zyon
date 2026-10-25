import type { PrismaClient } from "@prisma/client";
import type {
  PlatformInfrastructureIntegrationsRepository,
  PlatformPersistedIntegrationsSnapshot,
} from "../domain/ports/platform-infrastructure-observability.port.js";

export class PrismaPlatformInfrastructureIntegrationsRepository implements PlatformInfrastructureIntegrationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async snapshot(): Promise<PlatformPersistedIntegrationsSnapshot> {
    const [commerce, payments, erp, crm, erpSyncJobs] = await Promise.all([
      this.prisma.merchantCommerceConnection.groupBy({ by: ["provider", "status"], _count: { _all: true } }),
      this.prisma.merchantPaymentConnection.groupBy({ by: ["provider", "status"], _count: { _all: true } }),
      this.prisma.erpConnection.groupBy({ by: ["provider", "status"], _count: { _all: true } }),
      this.prisma.crmConnection.groupBy({ by: ["provider", "status"], _count: { _all: true } }),
      this.prisma.erpSyncJob.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    return {
      connection_states: [
        ...commerce.map((row) => ({ surface: "commerce" as const, provider: row.provider, status: row.status, count: row._count._all })),
        ...payments.map((row) => ({ surface: "payments" as const, provider: row.provider, status: row.status, count: row._count._all })),
        ...erp.map((row) => ({ surface: "erp" as const, provider: row.provider, status: row.status, count: row._count._all })),
        ...crm.map((row) => ({ surface: "crm" as const, provider: row.provider, status: row.status, count: row._count._all })),
      ].sort(compareConnectionStates),
      erp_sync_jobs: erpSyncJobs
        .map((row) => ({ status: row.status, count: row._count._all }))
        .sort((left, right) => left.status.localeCompare(right.status)),
    };
  }
}

function compareConnectionStates(
  left: PlatformPersistedIntegrationsSnapshot["connection_states"][number],
  right: PlatformPersistedIntegrationsSnapshot["connection_states"][number],
): number {
  return left.surface.localeCompare(right.surface)
    || left.provider.localeCompare(right.provider)
    || left.status.localeCompare(right.status);
}
