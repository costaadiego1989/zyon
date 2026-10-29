import { Queue } from "bullmq";
import type { RedisOptions } from "ioredis";
import type {
  PlatformInfrastructureQueueProbe,
  PlatformQueueCounts,
  PlatformQueueProbeResult,
  PlatformQueueSnapshot,
} from "../domain/ports/platform-infrastructure-observability.port.js";

type QueueDefinition = Pick<PlatformQueueSnapshot, "key" | "queue" | "description">;

type QueueClient = {
  getJobCounts(): Promise<Record<string, number>>;
  close(): Promise<void>;
};

type QueueClientFactory = (queue: string, connection: RedisOptions) => QueueClient;

const OBSERVED_QUEUES: readonly QueueDefinition[] = [
  { key: "domain_event_outbox", queue: "domain-event-outbox", description: "Encaminhamento de eventos duráveis do monólito." },
  { key: "payment_reconciliation", queue: "payment-reconciliation", description: "Reconciliação periódica de intenções de pagamento pendentes." },
  { key: "return_refund_reconciliation", queue: "return-refund-reconciliation", description: "Reconciliação periódica de reembolsos pendentes." },
  { key: "billing_trial_expiration", queue: "billing-trial-expiration", description: "Expiração de períodos de teste de assinatura." },
  { key: "crypto_verification", queue: "crypto-verify", description: "Verificação de transferências de pagamento em cripto." },
  { key: "catalog_stock_expiry", queue: "catalog-stock-expiry", description: "Liberação de reservas de estoque expiradas." },
  { key: "post_sale_messages", queue: "post-sale-message-sender", description: "Envio de mensagens pós-venda programadas." },
  { key: "revenue_manager_observations", queue: "revenue-manager-observations", description: "Observações periódicas do Revenue Manager." },
];

export class BullMqPlatformQueueProbe implements PlatformInfrastructureQueueProbe {
  constructor(
    private readonly redisUrl = process.env.REDIS_URL,
    private readonly queueClientFactory: QueueClientFactory = createBullMqQueueClient,
  ) {}

  async probe(): Promise<PlatformQueueProbeResult> {
    if (!this.redisUrl?.trim()) return { status: "not_configured", source: "bullmq", queues: [] };

    const connection = redisConnection(this.redisUrl);
    if (!connection) return { status: "unavailable", source: "bullmq", queues: [] };

    const snapshots = await Promise.all(OBSERVED_QUEUES.map((definition) => this.probeQueue(definition, connection)));
    const available = snapshots.filter((snapshot) => snapshot.status === "available").length;

    return {
      status: available === snapshots.length ? "available" : available > 0 ? "degraded" : "unavailable",
      source: "bullmq",
      queues: snapshots,
    };
  }

  private async probeQueue(definition: QueueDefinition, connection: RedisOptions): Promise<PlatformQueueSnapshot> {
    let client: QueueClient | undefined;
    try {
      client = this.queueClientFactory(definition.queue, connection);
      const counts = await client.getJobCounts();
      return { ...definition, status: "available", counts: presentCounts(counts) };
    } catch {
      return { ...definition, status: "unavailable" };
    } finally {
      await client?.close().catch(() => undefined);
    }
  }
}

function createBullMqQueueClient(queueName: string, connection: RedisOptions): QueueClient {
  const queue = new Queue(queueName, { connection });
  return {
    async getJobCounts() {
      return queue.getJobCounts("waiting", "active", "delayed", "failed", "paused", "prioritized");
    },
    async close() {
      await queue.close();
    },
  };
}

function presentCounts(counts: Record<string, number>): PlatformQueueCounts {
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    paused: counts.paused ?? 0,
    prioritized: counts.prioritized ?? 0,
  };
}

function redisConnection(raw: string | undefined): RedisOptions | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
      tls: url.protocol === "rediss:" ? {} : undefined,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    };
  } catch {
    return undefined;
  }
}
