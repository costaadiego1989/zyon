import assert from "node:assert/strict";
import test from "node:test";
import {
  detectPlatformInfrastructureIncidents,
  summarizePlatformInfrastructureIncidentHistory,
} from "./platform-infrastructure-incidents.js";

test("derives local alerts from direct readiness, queue failures, and persisted integration states", () => {
  const result = detectPlatformInfrastructureIncidents({
    readiness: { database: "disconnected", redis: "disconnected" },
    queues: {
      status: "degraded",
      source: "bullmq",
      queues: [
        { key: "outbox", queue: "domain-event-outbox", description: "Outbox", status: "available", counts: { waiting: 0, active: 0, delayed: 0, failed: 3, paused: 0, prioritized: 0 } },
        { key: "payments", queue: "payment-reconciliation", description: "Payments", status: "unavailable" },
      ],
    },
    integrations: {
      connection_states: [
        { surface: "erp", provider: "omie", status: "error", count: 2 },
        { surface: "crm", provider: "hubspot", status: "connected", count: 1 },
      ],
      erp_sync_jobs: [
        { status: "failed", count: 4 },
        { status: "completed", count: 9 },
      ],
    },
  });

  assert.deepEqual(result.map((incident) => incident.id), [
    "readiness:database:disconnected",
    "readiness:redis:disconnected",
    "queue:outbox:failed_jobs",
    "queue:payments:unavailable",
    "integration:erp:omie:error",
    "integration:erp_sync:failed",
  ]);
  assert.equal(result[0]?.severity, "critical");
  assert.match(result[4]?.description ?? "", /painel não consulta o provedor externo/i);
});

test("uses a single critical alert when BullMQ cannot be queried at all", () => {
  const result = detectPlatformInfrastructureIncidents({
    readiness: { database: "connected", redis: "connected" },
    queues: {
      status: "unavailable",
      source: "bullmq",
      queues: [{ key: "outbox", queue: "domain-event-outbox", description: "Outbox", status: "unavailable" }],
    },
    integrations: undefined,
  });

  assert.deepEqual(result, [{
    id: "queue:bullmq:unavailable",
    severity: "critical",
    source: "queue",
    title: "Filas BullMQ indisponíveis",
    description: "Nenhuma fila observada pôde ser consultada nesta leitura local.",
  }]);
});

test("summarizes persisted observations without claiming that a missing alert was resolved", () => {
  const current = {
    id: "queue:outbox:failed_jobs",
    severity: "warning" as const,
    source: "queue" as const,
    title: "Falhas na fila domain-event-outbox",
    description: "2 trabalho(s) com falha foram encontrados na leitura atual.",
  };
  const historicalOnly = {
    id: "integration:erp_sync:failed",
    severity: "warning" as const,
    source: "integration" as const,
    title: "Falhas em sincronizações ERP",
    description: "1 trabalho ERP falhou.",
  };

  const result = summarizePlatformInfrastructureIncidentHistory([
    { incident: current, observedAt: new Date("2026-09-15T10:00:00.000Z") },
    { incident: current, observedAt: new Date("2026-09-15T11:00:00.000Z") },
    { incident: historicalOnly, observedAt: new Date("2026-09-15T09:00:00.000Z") },
  ], [current], new Date("2026-09-15T12:00:00.000Z"));

  assert.deepEqual(result.map((item) => ({
    id: item.id,
    observations: item.observations,
    state: item.state,
    first: item.firstObservedAt.toISOString(),
    last: item.lastObservedAt.toISOString(),
  })), [
    {
      id: "queue:outbox:failed_jobs",
      observations: 3,
      state: "present_in_current_read",
      first: "2026-09-15T10:00:00.000Z",
      last: "2026-09-15T12:00:00.000Z",
    },
    {
      id: "integration:erp_sync:failed",
      observations: 1,
      state: "not_present_in_current_read",
      first: "2026-09-15T09:00:00.000Z",
      last: "2026-09-15T09:00:00.000Z",
    },
  ]);
});
