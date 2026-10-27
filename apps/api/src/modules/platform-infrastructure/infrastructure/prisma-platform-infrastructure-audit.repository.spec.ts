import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPlatformInfrastructureAuditRepository } from "./prisma-platform-infrastructure-audit.repository.js";

test("writes sanitized local incident observations into the existing platform audit journal", async () => {
  const writes: unknown[] = [];
  const repository = new PrismaPlatformInfrastructureAuditRepository({
    platformAuditEvent: {
      create: async (input: unknown) => { writes.push(input); },
      findMany: async () => [],
    },
  } as never);

  await repository.recordRead({
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
    incidents: [{
      id: "queue:outbox:failed_jobs",
      severity: "warning",
      source: "queue",
      title: "Falhas na fila domain-event-outbox",
      description: "2 trabalho(s) com falha foram encontrados na leitura atual.",
    }],
  });

  assert.deepEqual(writes, [{
    data: {
      actorOperatorId: "operator_1",
      action: "platform.infrastructure.readiness.read",
      permission: "platform:infrastructure:read",
      environment: "test",
      targetType: "platform_infrastructure_readiness",
      correlationId: "corr_1",
      outcome: "succeeded",
      details: {
        source: "direct_readiness_probe",
        incident_count: 1,
        incident_observations: [{
          id: "queue:outbox:failed_jobs",
          severity: "warning",
          source: "queue",
          title: "Falhas na fila domain-event-outbox",
          description: "2 trabalho(s) com falha foram encontrados na leitura atual.",
        }],
      },
    },
  }]);
});

test("reads only valid observations from readiness audit snapshots", async () => {
  const calls: unknown[] = [];
  const repository = new PrismaPlatformInfrastructureAuditRepository({
    platformAuditEvent: {
      create: async () => undefined,
      findMany: async (input: unknown) => {
        calls.push(input);
        return [
          {
            createdAt: new Date("2026-09-15T12:00:00.000Z"),
            details: {
              incident_observations: [{
                id: "integration:erp_sync:failed",
                severity: "warning",
                source: "integration",
                title: "Falhas em sincronizações ERP",
                description: "2 trabalho(s) ERP estão com estado persistido de falha.",
              }],
            },
          },
          {
            createdAt: new Date("2026-09-15T11:00:00.000Z"),
            details: {
              incident_observations: [
                { id: "bad id with spaces", severity: "warning", source: "queue", title: "Bad", description: "Bad" },
                "not_an_incident",
              ],
            },
          },
        ];
      },
    },
  } as never);

  const result = await repository.listRecentIncidentObservations(999);

  assert.deepEqual(calls, [{
    where: {
      action: "platform.infrastructure.readiness.read",
      targetType: "platform_infrastructure_readiness",
    },
    select: {
      createdAt: true,
      details: true,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 180,
  }]);
  assert.deepEqual(result.map((observation) => ({
    id: observation.incident.id,
    observedAt: observation.observedAt.toISOString(),
  })), [{
    id: "integration:erp_sync:failed",
    observedAt: "2026-09-15T12:00:00.000Z",
  }]);
});
